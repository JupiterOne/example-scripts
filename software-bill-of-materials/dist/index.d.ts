export declare type Component = {
    type: string;
    'bom-ref': string;
    name: string;
    version: string;
    description: string;
    licenses: {
        license: {
            id: string;
        };
    }[];
    purl: string;
    externalReferences: [];
    scope: string;
};
export declare type CodeModuleEntity = {
    entity: {
        _type: string[];
        _class: string[];
    };
    properties: {
        name: string;
        license: string;
        version: string;
    };
};
