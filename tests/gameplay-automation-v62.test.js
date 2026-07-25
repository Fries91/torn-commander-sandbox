"use strict";

const assert = require("assert");
process.env.ARENA_V62_TEST_MODE = "1";
const { version, marker, injectGameplayAutomationV62 } = require("../gameplay-automation-v62-register");

assert.equal(version, "62.0.0");
assert(marker.includes("v62"));

const minimal = `
"use strict";
const PHASES=[];
function createId(){}
function nowIso(){}
function currentOracleText(){}
function currentTypeLine(){}
function isCreatureCard(){}
function hasKeyword(){}
function clamp(){}
function findPlayer(){}
function locateCard(){}
function controlledBattlefieldCard(){}
function getCardFromZone(){}
function moveCard(){}
function queueSuggestedTriggers(){}
function queueTrigger(){}
function pushStack(){}
function addLog(){}
function validateTargets(){}
function activePlayerIds(){}
function resetPriority(){}
function runStateBasedActions(){}
function recordReplayFrame(){}
function queueRoomSave(){}
function emitRoomUpdate(){}
function scheduleBots(){}
function authenticationFrom(){}
function effectiveStats(){}
function keywordSet(){}
function publicCard(){}
function resolveStackTop(){}
function processGameAction(){}
function advanceTurn(){}
function createPublicRoom(){}
const rooms=new Map();
const app={post(){},get(){}};
async function start(){}
`;

const patched = injectGameplayAutomationV62(minimal);
assert(patched.includes(marker));
assert(patched.includes("/api/gameplay-v62/action"));
assert.equal(injectGameplayAutomationV62(patched), patched);
console.log("Arena Commander v62 gameplay automation injection tests passed.");
