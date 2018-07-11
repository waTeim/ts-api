const express = require("express");

export default class RouterPod {
  routers:any;
  public prefix: string;
  public app: any;

  constructor(app: any) {
    this.app = app;
    this.routers = {};
  }
  getRouter(name:string) { return this.routers[name]; }
  addRouter(name:string):void { this.routers[name] = express.Router(); };
}
