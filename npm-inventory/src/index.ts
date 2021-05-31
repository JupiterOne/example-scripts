import * as glob from "glob";
import { join, dirname } from "path";
import * as fs from "fs";
import { retry } from "@lifeomic/attempt";

const JupiterOneClient = require("@jupiterone/jupiterone-client-nodejs");

if (!process.env.J1_API_TOKEN) {
  throw new Error('Missing J1_API_TOKEN ENV Var!');
}

if (!process.env.J1_ACCOUNT) {
  throw new Error('Missing J1_ACCOUNT ENV Var!');
}

export interface Dependency {
  name: string;
  version: string;
  license: string;
  direct: boolean;
}

function seekLicenseFile(moduleDir): string {
  // best-effort attempt to retrieve first line that looks like it might contain
  // RegExp(/LICENSE/i) from likely files in filesystem

  const pattern = moduleDir + '/LICENSE*';
  const licenseFiles = glob.sync(pattern);
  const licenseFile = licenseFiles[0];
  if (!licenseFile) {
    return 'unset';
  }
  const lines = fs.readFileSync(licenseFile, 'utf8').split('\n');
  let lineMatch;
  const matched = lines.some(line => {
    lineMatch = line;
    return line.match(/\bLICENSE\b/i);
  });
  const license = matched ? lineMatch : 'unset';
  return license;
}

function scrutinizeLicense(pkg, moduleDir): string {
  if ((pkg.license || {}).type) {
    return pkg.license.type;
  }
  if ((pkg.licenses || {}).type) {
    return pkg.licenses.type;
  }
  if (pkg.license && !pkg.license.match(/see license/i)) {
    return pkg.license;
  }
  return seekLicenseFile(moduleDir);
}

async function inventoryPackages(dir: string, directDependencies: string[]): Promise<Dependency[]> {
  const modulePaths = glob.sync(join(dir, "node_modules/**/package.json"));
  const dependencyCSVSet: Set<string> = new Set();
  modulePaths.forEach((modulePath) => {
    const pkg = require(modulePath);  // load package.json from module
    if (!pkg.name || !pkg.version) {
      return; // skip non top-level package.json files
    }
    const license = scrutinizeLicense(pkg, join(dir, dirname(modulePath)));
    const isDirect = directDependencies.includes(pkg.name);
    dependencyCSVSet.add(`${pkg.name},${pkg.version},${license},${isDirect ? 'direct' : 'indirect'}`);
  });
  const inventory: Dependency[] = [];
  Array.from(dependencyCSVSet).forEach(dependencyCSV => {
    const [name, version, license, directStr] = dependencyCSV.split(',');
    inventory.push({
      name,
      version,
      license,
      direct: directStr === 'direct'
    });
  });

  return inventory;
}

async function run (baseDir): Promise<void> {
  const j1Client = await new JupiterOneClient({
    account: process.env.J1_ACCOUNT,
    accessToken: process.env.J1_API_TOKEN,
    dev: false
  }).init();

  const repoPkg = require(join(baseDir, 'package.json'));
  // NOTE: NPM package name may be different than repo name
  const repoName = baseDir.split('/').pop();

  console.log('Gathering CodeRepo data from JupiterOne...');
  const codeRepoIdMap = await getCodeRepoIdMap(j1Client);

  const codeRepoEntityId = codeRepoIdMap[repoName];
  if (!codeRepoEntityId) {
    console.error(`ERROR: ${repoName} doesn't appear to be a CodeRepo known to JupiterOne!`);
    process.exit(3);
  }

  const npmPackageIdMap = await getNPMPackageIdMap(j1Client);
  console.log(`${Object.keys(codeRepoIdMap).length} coderepos found in J1`);
  console.log(`${Object.keys(npmPackageIdMap).length} NPM packages found in J1`);

  console.log(`inventory for ${repoPkg.name}@${repoPkg.version}, license: ${repoPkg.license}:\n`);

  // TODO: flag prod/dev deps separately
  const directDependencies = Object.keys(repoPkg.dependencies || {}).concat(Object.keys(repoPkg.devDependencies || {}));

  const inventory = await inventoryPackages(baseDir, directDependencies);
  console.log(`${inventory.length} unique dependencies`);
  const directInventory = inventory.filter(i => i.direct);

  const attemptOptions = {
    delay: 20000,
    factor: 1.5,
    maxAttempts: 0,
    maxDelay: 70,
    beforeAttempt (context, options): void {
      console.log(`attempt number ${context.attemptNum}...`);
    }
  };

  for (const dep of directInventory) {
    let packageId = npmPackageIdMap[dep.name];
    let res: any;
    if (!packageId) {
      console.log(`Creating CodeModule entity for ${dep.name} npm_package in J1...`);
      res = await retry(() => {
        return j1Client.createEntity(
          `npm_package:${dep.name}`, //_key
          'npm_package', //_type
          'CodeModule', //_class
          {
            displayName: dep.name,
            fullName: dep.name,
            name: dep.name.split('/').pop(),
            license: dep.license,
            scope: dep.name.split('/')[0].replace(/^@/,''),
            version: dep.version
          }
        );
      }, attemptOptions);
      packageId = res.vertex.entity._id;
    }
    console.log(`Creating ${repoName} -USES-> ${dep.name} relationship in J1...`);
    res = await retry(() => {
      return j1Client.createRelationship(
        `${codeRepoEntityId}:USES:${packageId}`, //_key
        'coderepo_uses_codemodule', //_type
        'USES', //_class
        codeRepoEntityId, //fromId
        packageId, //toId
        {
          displayName: `${repoName}:USES:${dep.name}`,
          directDependency: dep.direct,
          devDependency: Object.keys(repoPkg.devDependencies).includes(dep.name),
          version: dep.version,
        }
      );
    }, attemptOptions);
  }

  console.log(`${directInventory.length} direct dependencies found.`)
}

async function getCodeRepoIdMap (j1Client: typeof JupiterOneClient): Promise<object> {
  const cacheFile = `/tmp/codeRepoIdMap-${process.env.J1_ACCOUNT}.json`;
  if (fs.existsSync(cacheFile)) {
    return require(cacheFile);
  }

  const repos = await j1Client.queryV1('Find CodeRepo as c return c.name as name, c._id as id');
  const map = {};
  repos.forEach(repo => {
    map[repo.name] = repo.id;
  });

  fs.writeFileSync(cacheFile, JSON.stringify(map), 'utf8');
  return map;
}

async function getNPMPackageIdMap (j1Client: typeof JupiterOneClient, shouldCache = false): Promise<object> {
  const cacheFile = `/tmp/codeModuleIdMap-${process.env.J1_ACCOUNT}.json`;
  if (shouldCache && fs.existsSync(cacheFile)) {
    return require(cacheFile);
  }

  const repos = await j1Client.queryV1('Find npm_package as p return p.id as name, p._id as id');
  const map = {};
  repos.forEach(repo => {
    map[repo.name] = repo.id;
  });

  if (shouldCache) {
    fs.writeFileSync(cacheFile, JSON.stringify(map), 'utf8');
  }
  return map;
}

run(process.argv[2]).catch(console.error);
