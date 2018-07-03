const uuid = require('uuid/v1');

export default class EndpointCheckBinding {
  id: string;
  check: any;

  constructor(check: any) {
    this.check = check;
    this.id = uuid();
  }
}
