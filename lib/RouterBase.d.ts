export default class RouterBase {
    routers: any;
    prefix: string;
    app: any;
    constructor(app: any);
    getRouter(name: string): any;
    addRouter(name: string): void;
}
