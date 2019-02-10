import ControllerProperties from './ControllerProperties'; 

/**
 * ControllerBase
 * 
 * A baseclass to coordinate ts-api REST endpoint callback and typechecks 
 * by simply declaring a string valued id. The class also declares a placeholder
 * for coordination via context.  Controller classes should derive from this
 * class. Derived classes will automatically be constructed from these values.
 */
export default class ControllerBase {
  protected properties: ControllerProperties;
  public path: string;

  constructor(properties:ControllerProperties) {
    this.properties = properties;
  }
 
  getEndpointSignatureBinding() { return this.properties.binding; }
  getProperties() { return this.properties; }
}
