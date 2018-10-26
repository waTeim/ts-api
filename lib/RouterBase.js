"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var express = require("express");
var RouterBase = /** @class */ (function () {
    function RouterBase(context) {
        this.context = context;
        this.routers = {};
        this.root = express.Router();
    }
    RouterBase.prototype.getRouter = function (name) {
        if (name == null)
            return this.root;
        return this.routers[name];
    };
    RouterBase.prototype.addRouter = function (path, name) {
        this.routers[name] = express.Router();
        this.root.use(path, this.routers[name]);
    };
    ;
    return RouterBase;
}());
exports.default = RouterBase;
//# sourceMappingURL=RouterBase.js.map