import * as fs from "fs-extra";

const JupiterOneClient = require("@jupiterone/jupiterone-client-nodejs");

if (!process.env.J1_API_TOKEN) {
  throw new Error('Missing J1_API_TOKEN ENV Var!');
}

if (!process.env.J1_ACCOUNT) {
  throw new Error('Missing J1_ACCOUNT ENV Var!');
}

export type Component = {
  type: string;
  'bom-ref': string;
  name: string;
  version: string;
  description: string;
  licenses: {
    license: {
      id: string;
    }
  }[];
  purl: string;
  externalReferences: [];
  scope: string;
};

export type CodeModuleEntity = {
  entity: {
    _type: string[];
    _class: string[];
  }
  properties: {
    name: string;
    license: string;
    version: string;
  }
};

async function run (): Promise<void> {
  const j1Client = await new JupiterOneClient({
    account: process.env.J1_ACCOUNT,
    accessToken: process.env.J1_API_TOKEN,
    dev: false
  }).init();

  const j1ql = process.argv[2] || 'Find npm_package with license!=undefined and version!=undefined THAT USES as u CodeRepo WHERE u.directDependency=true';
  console.log(`searching J1 with: "${j1ql}"...`);
  const modules: CodeModuleEntity[] = await j1Client.queryV1(j1ql);
  console.log(`found ${modules.length} NPM packages in J1...`);

  const components: Component[] = [];

  for (const module of modules) {
    const { name, version, license } = module.properties;

    const purl = 'pkg:npm/' + name + '@' + version;

    components.push({
      type: 'library',
      "bom-ref": purl,
      name,
      version,
      description: '',
      licenses: [{
        license: {
          id: license
        }
      }],
      purl,
      externalReferences: [],
      scope: 'required'
    });
  }

  const bom = JSON.parse(await fs.readFile('./bom.json', 'utf8'));
  bom.components = components;

  await fs.writeFile('sbom.json', JSON.stringify(bom, null, 2));
  console.log('wrote software bill-of-materials to "sbom.json"');
}

run().catch(console.error);