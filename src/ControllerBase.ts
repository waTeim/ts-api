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
  app: any;
  binding: EndpointCheckBinding;

  constructor(app: any,binding: EndpointCheckBinding) {
    this.app = app;
    this.binding = binding;
  }
}
