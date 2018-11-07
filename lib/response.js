"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var uuidv1 = require('uuid/v1');
/**
 * General REST processing in case of an error
 */
function error(e, req, res, next) {
    if (res._header == null) {
        if (e.stack) {
            var ref = uuidv1();
            var status_1 = 500;
            if (e.status)
                status_1 = e.status;
            console.log("response error " + ref + ":", e.stack);
            res.status(status_1).send("<pre>\nerror: ref " + ref + ", check logs for further information\n</pre>");
        }
        else {
            if (e.status != null)
                res.status(e.status).send({ error: e });
            else
                next(e);
        }
    }
}
/**
 * REST processing in case of endpoint success
 */
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