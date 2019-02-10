import EndpointCheckBinding from './EndpointCheckBinding'; 

export default class ControllerInitializer {
  public binding: EndpointCheckBinding;
  public context: any;
  public req: any;
  public res: any;
  public next: Function;

  constructor(binding: EndpointCheckBinding,context:any,req:any,res:any,next:Function) {
    this.binding = binding;
    this.context = context;
    this.req = req;
    this.res = res;
    this.next = next;
  }
}
