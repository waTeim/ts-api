"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function error(e, req, res, next) {
    if (res._header == null) {
        if (e.stack) {
            if (e.status != null)
                res.status(e.status).send("<pre>" + e.stack + "</pre>");
            else
                res.send("<pre>" + e.stack + "</pre>");
        }
        else {
            if (e.status != null)
                res.status(e.status).send({ error: e });
            else
                next(e);
        }
    }
}
function success(obj, req, res, next) {
    if (res._header == null) {
        if (obj == null)
            console.error("API return null result");
        else
            res.send(obj);
    }
}
exports.default = { error: error, success: success };
//# sourceMappingURL=response.js.map