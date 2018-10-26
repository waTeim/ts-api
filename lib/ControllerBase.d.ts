import EndpointCheckBinding from './EndpointCheckBinding';
/**
 * ControllerBase
 *
 * A baseclass to coordinate ts-api REST endpoint callback and typechecks
 * by simply declaring a string valued id. The class also declares a placeholder
 * for coordination via context.  Controller classes should derive from this
 * class. Derived classes will automatically be constructed from these values.
 */
export default class ControllerBase {
    binding: EndpointCheckBinding;
    path: string;
    context: any;
    req: any;
    res: any;
    next: Function;
    constructor(context: any, binding: EndpointCheckBinding, req: any, res: any, next: Function);
    getEndpointSignatureBinding(): EndpointCheckBinding;
}
