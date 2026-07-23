"use strict";

const { syncMetaDecks } = require("../meta-sync");

syncMetaDecks()
  .then((result) => {
    console.log(JSON.stringify({ success: true, ...result }, null, 2));
    process.exitCode = result.failed && !result.added && !result.updated && !result.unchanged ? 1 : 0;
  })
  .catch((error) => {
    console.error(JSON.stringify({ success: false, error: error.message }, null, 2));
    process.exitCode = 1;
  });
