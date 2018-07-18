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

  public path: string;
  public app: any;
  public req: any;
  public res: any;
  public next: Function;

  constructor(app: any,binding: EndpointCheckBinding,req:any,res:any,next:Function) {
    this.app = app;
    this.binding = binding;
    this.req = req;
    this.res = res;
    this.next = next;
  }
 
  getEndpointSignatureBinding() { return this.binding; }
}
