"use strict";

const expressPath = require.resolve("express");
const realExpress = require(expressPath);
const { installMetaLibrary } = require("./meta-library-server");

function wrappedExpress(...args) {
  const app = realExpress(...args);
  const originalUse = app.use.bind(app);
  app.use = function patchedUse(...useArgs) {
    if (!app.locals.metaLibraryInstalled && useArgs[0] === "/api") {
      installMetaLibrary({ app });
    }
    return originalUse(...useArgs);
  };
  return app;
}

Object.assign(wrappedExpress, realExpress);
Object.setPrototypeOf(wrappedExpress, realExpress);
require.cache[expressPath].exports = wrappedExpress;
