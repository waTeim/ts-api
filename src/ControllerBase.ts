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

  public path: string;
  public context: any;
  public req: any;
  public res: any;
  public next: Function;

  constructor(context:any,binding: EndpointCheckBinding,req:any,res:any,next:Function) {
    this.context = context;
    this.binding = binding;
    this.req = req;
    this.res = res;
    this.next = next;
  }
 
  getEndpointSignatureBinding() { return this.binding; }
}
