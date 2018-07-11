"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var express = require("express");
var RouterPod = /** @class */ (function () {
    function RouterPod(app) {
        this.app = app;
        this.routers = {};
    }
    RouterPod.prototype.getRouter = function (name) { return this.routers[name]; };
    RouterPod.prototype.addRouter = function (name) { this.routers[name] = express.Router(); };
    ;
    return RouterPod;
}());
exports.default = RouterPod;
//# sourceMappingURL=RouterBase.js.map