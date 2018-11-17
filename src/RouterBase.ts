const express = require("express");

export default class RouterBase {
  root:any;
  routers:any;
  public prefix: string;
  public context: any;

  constructor(context:any) {
    this.context = context;
    this.routers = {};
    this.root = express.Router();
  }
  getExpressRouter(name?:string) { 
    if(name == null) return this.root;
    return this.routers[name];
  }
  addRouter(path:string,name:string,options):void { 
    this.routers[name] = express.Router(options);
    this.root.use(path,this.routers[name]);
  };
}
