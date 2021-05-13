"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs-extra"));
const JupiterOneClient = require("@jupiterone/jupiterone-client-nodejs");
if (!process.env.J1_API_TOKEN) {
    throw new Error('Missing J1_API_TOKEN ENV Var!');
}
if (!process.env.J1_ACCOUNT) {
    throw new Error('Missing J1_ACCOUNT ENV Var!');
}
async function run() {
    const j1Client = await new JupiterOneClient({
        account: process.env.J1_ACCOUNT,
        accessToken: process.env.J1_API_TOKEN,
        dev: false
    }).init();
    const j1ql = process.argv[2] || 'Find npm_package with license!=undefined and version!=undefined THAT USES as u CodeRepo WHERE u.directDependency=true';
    console.log(`searching J1 with: "${j1ql}"...`);
    const modules = await j1Client.queryV1(j1ql);
    console.log(`found ${modules.length} NPM packages in J1...`);
    const components = [];
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
