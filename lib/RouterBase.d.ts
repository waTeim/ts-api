export default class RouterBase {
    root: any;
    routers: any;
    prefix: string;
    context: any;
    constructor(context: any);
    getRouter(name?: string): any;
    addRouter(path: string, name: string): void;
}
