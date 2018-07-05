import EndpointCheckBinding from './EndpointCheckBinding';
/**
 * ControllerBase
 *
 * A baseclass to coordinate ts-api REST endpoint callback and typechecks
 * by simply declaring a string valued id. The class also declares a placeholder
 * for express coordination via app.  Controller classes should derive from this
 * class. Derived classes will automatically be constructed from these values.
 */
export default class ControllerBase {
    binding: EndpointCheckBinding;
    app: any;
    req: any;
    res: any;
    next: Function;
    constructor(app: any, binding: EndpointCheckBinding, req: any, res: any, next: Function);
    getEndpointSignatureBinding(): EndpointCheckBinding;
}
