"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var express = require("express");
var RouterBase = /** @class */ (function () {
    function RouterBase(app) {
        this.app = app;
        this.routers = {};
    }
    RouterBase.prototype.getRouter = function (name) { return this.routers[name]; };
    RouterBase.prototype.addRouter = function (name) { this.routers[name] = express.Router(); };
    ;
    return RouterBase;
}());
exports.default = RouterBase;
//# sourceMappingURL=RouterBase.js.map