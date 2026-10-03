"use strict";

/* ---------- constants ---------- */
const NREG = 4;
const NMEM = 16;
const MASK = 255;
const STAGE_NAMES = ["Fetch", "Decode", "Execute", "Update PC"];
const EXAMPLE = `MOV R1, 10
MOV R2, 5
ADD R1, R2
SUB R1, R2
HALT`;

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");

/* ---------- state ---------- */
let program = [];            // parsed instructions
let errorText = "";
let init = { regs: Array(NREG).fill(0), mem: Array(NMEM).fill(0) };
let s = freshState();
let timer = null;

function freshState() {
  return {
    pc: 0, ir: "-", stage: 0, active: -1,
    regs: [...init.regs], mem: [...init.mem],
    flags: { Z: 0, C: 0, S: 0 },
    decoded: null, alu: null, memHit: -1,
    halted: false, steps: 0,
    status: "Ready. Press Next step or Run.", kind: "idle",
    log: []
  };
}

/* ---------- parsing ---------- */
function parseNumber(t) {
  if (/^-?\d+$/.test(t) || /^0x[0-9a-f]+$/i.test(t)) return Number(t);
  return null;
}

function parseOperand(t, allowImm) {
  const reg = /^R([0-9])$/i.exec(t);
  if (reg) {
    const n = Number(reg[1]);
    return n < NREG ? { t: "reg", v: n } : null;
  }
  if (allowImm) {
    const n = parseNumber(t);
    if (n !== null && n >= -128 && n <= 255) return { t: "imm", v: n & MASK };
  }
  return null;
}

function parseAddr(t) {
  const n = parseNumber(t.replace(/^\[|\]$/g, "").trim());
  return n !== null && n >= 0 && n < NMEM ? { t: "addr", v: n } : null;
}

function parseLine(raw, lineNo) {
  const text = raw.split(/[;#]/)[0].trim();
  if (!text) return null;
  const m = /^([A-Za-z]+)\s*(.*)$/.exec(text);
  const op = m[1].toUpperCase();
  const args = m[2] ? m[2].split(",").map((a) => a.trim()) : [];
  const fail = (msg) => { throw new Error(`Line ${lineNo}: ${msg}`); };

  const twoOperand = ["MOV", "ADD", "SUB", "AND", "OR"];
  if (op === "HALT") {
    if (args.length) fail("HALT takes no operands.");
    return { op, text: "HALT" };
  }
  if (![...twoOperand, "LOAD", "STORE"].includes(op)) fail(`Unknown instruction "${m[1]}".`);
  if (args.length !== 2) fail(`${op} needs two operands, like ${op} R1, 5.`);

  let a, b;
  if (twoOperand.includes(op)) {
    a = parseOperand(args[0], false);
    b = parseOperand(args[1], true);
    if (!a) fail(`"${args[0]}" is not a register (R0 to R${NREG - 1}).`);
    if (!b) fail(`"${args[1]}" must be a register or a number from -128 to 255.`);
  } else {
    a = parseOperand(args[0], false);
    b = parseAddr(args[1]);
    if (!a) fail(`"${args[0]}" is not a register (R0 to R${NREG - 1}).`);
    if (!b) fail(`"${args[1]}" must be a memory address from 0 to ${NMEM - 1}.`);
  }
  return { op, a, b, text: `${op} ${args[0].toUpperCase()}, ${args[1].toUpperCase()}` };
}

function parseProgram(src) {
  const out = [];
  src.split("\n").forEach((line, i) => {
    const ins = parseLine(line, i + 1);
    if (ins) out.push(ins);
  });
  return out;
}

/* ---------- CPU stages ---------- */
function addLog(msg) {
  s.log.unshift(msg);
  if (s.log.length > 80) s.log.pop();
}

function setStatus(msg, kind) {
  s.status = msg;
  s.kind = kind || "run";
  addLog(msg);
}

function execute(d) {
  const r = s.regs;
  const val = (o) => (o.t === "reg" ? r[o.v] : o.v);
  s.memHit = -1;
  let res;

  switch (d.op) {
    case "MOV":
      res = val(d.b); r[d.a.v] = res;
      s.alu = { a: "-", op: "MOV", b: res, res };
      return `R${d.a.v} = ${res}`;

    case "LOAD":
      res = s.mem[d.b.v]; r[d.a.v] = res; s.memHit = d.b.v;
      s.alu = { a: "-", op: "LOAD", b: `M[${d.b.v}]`, res };
      return `R${d.a.v} = memory[${d.b.v}] = ${res}`;

    case "STORE":
      res = r[d.a.v]; s.mem[d.b.v] = res; s.memHit = d.b.v;
      s.alu = { a: res, op: "STORE", b: `M[${d.b.v}]`, res };
      return `memory[${d.b.v}] = R${d.a.v} = ${res}`;

    default: { // ADD SUB AND OR
      const A = r[d.a.v], B = val(d.b);
      let raw;
      if (d.op === "ADD") raw = A + B;
      else if (d.op === "SUB") raw = A - B;
      else if (d.op === "AND") raw = A & B;
      else raw = A | B;
      res = raw & MASK;
      r[d.a.v] = res;
      s.flags.Z = res === 0 ? 1 : 0;
      s.flags.S = res >> 7;
      s.flags.C = (d.op === "ADD" && raw > MASK) || (d.op === "SUB" && raw < 0) ? 1 : 0;
      s.alu = { a: A, op: d.op, b: B, res };
      const sym = { ADD: "+", SUB: "-", AND: "AND", OR: "OR" }[d.op];
      return `R${d.a.v} = ${A} ${sym} ${B} = ${res}`;
    }
  }
}

/* Runs one stage. Returns false when the machine can't continue. */
function step() {
  if (s.halted || errorText || program.length === 0) return false;

  const stage = s.stage;
  s.active = stage;
  s.steps++;

  if (stage === 0) { // FETCH
    if (s.pc >= program.length) {
      s.halted = true;
      setStatus(`PC = ${pad(s.pc)} is past the last instruction. Add a HALT.`, "warn");
      return false;
    }
    s.ir = program[s.pc].text;
    s.decoded = null; s.alu = null; s.memHit = -1;
    setStatus(`Fetch: memory[${pad(s.pc)}] goes into IR (${s.ir}).`);
    s.stage = 1;

  } else if (stage === 1) { // DECODE
    s.decoded = program[s.pc];
    const d = s.decoded;
    const detail = d.op === "HALT" ? "no operands"
      : `destination/first ${d.a.t === "reg" ? "R" + d.a.v : d.a.v}, second ${d.b.t === "reg" ? "R" + d.b.v : d.b.t === "addr" ? "M[" + d.b.v + "]" : d.b.v}`;
    setStatus(`Decode: opcode ${d.op}, ${detail}.`);
    s.stage = 2;

  } else if (stage === 2) { // EXECUTE
    const d = s.decoded;
    if (d.op === "HALT") {
      s.halted = true;
      setStatus(`Execute: HALT. Stopped with PC = ${pad(s.pc)}.`, "halt");
      return false;
    }
    setStatus(`Execute: ${execute(d)}.`);
    s.stage = 3;

  } else { // UPDATE PC
    const old = s.pc;
    s.pc++;
    setStatus(`Update PC: ${pad(old)} to ${pad(s.pc)}.`);
    s.stage = 0;
  }
  return true;
}

/* ---------- controls ---------- */
function stopRun() {
  clearInterval(timer);
  timer = null;
}

function startRun() {
  if (timer || s.halted || errorText) return;
  const delay = 1100 - Number($("speed").value) * 100; // 1 slow ... 10 fast
  timer = setInterval(() => {
    if (!step()) stopRun();
    render();
  }, delay);
  render();
}

function reset() {
  stopRun();
  s = freshState();
  render();
}

function loadSource() {
  stopRun();
  try {
    program = parseProgram($("src").value);
    errorText = "";
  } catch (e) {
    program = [];
    errorText = e.message;
  }
  s = freshState();
  render();
}

/* ---------- rendering ---------- */
function buildStaticUI() {
  const grid = $("memGrid");
  for (let i = 0; i < NMEM; i++) {
    const l = document.createElement("label");
    l.id = `mcell${i}`;
    l.innerHTML = `${pad(i)}<input id="m${i}" type="number" min="0" max="255" aria-label="Data memory ${i}">`;
    grid.appendChild(l);
    l.querySelector("input").addEventListener("change", (e) => onCellEdit("mem", i, e.target.value));
  }
  for (let i = 0; i < NREG; i++) {
    $(`r${i}`).addEventListener("change", (e) => onCellEdit("regs", i, e.target.value));
  }
}

function onCellEdit(kind, i, raw) {
  const n = Math.min(MASK, Math.max(0, parseInt(raw, 10) || 0));
  s[kind][i] = n;
  if (s.steps === 0) init[kind][i] = n; // editing before the run sets the starting value
  render();
}

function render() {
  const running = !!timer;
  const done = s.halted || !!errorText || program.length === 0;

  $("err").textContent = errorText;
  $("pc").textContent = pad(s.pc);
  $("ir").textContent = s.ir;

  s.regs.forEach((v, i) => { if (document.activeElement !== $(`r${i}`)) $(`r${i}`).value = v; });
  s.mem.forEach((v, i) => {
    const inp = $(`m${i}`);
    if (document.activeElement !== inp) inp.value = v;
    $(`mcell${i}`).classList.toggle("hit", i === s.memHit);
  });

  for (const f of ["Z", "C", "S"]) {
    $(`f${f}`).textContent = `${f} ${s.flags[f]}`;
    $(`f${f}`).classList.toggle("on", s.flags[f] === 1);
  }

  STAGE_NAMES.forEach((_, i) => {
    $(`st${i}`).classList.toggle("active", s.active === i && !(s.halted && i === 3));
    $(`st${i}`).classList.toggle("next", !s.halted && s.stage === i && s.active !== i);
  });

  const a = s.alu;
  $("aluA").textContent = a ? a.a : "-";
  $("aluOp").textContent = a ? a.op : "-";
  $("aluB").textContent = a ? a.b : "-";
  $("aluR").textContent = a ? a.res : "-";

  const st = $("status");
  st.textContent = errorText ? "Fix the error to run the program." : program.length === 0 ? "Type a program on the left." : s.status;
  st.className = "status " + (errorText ? "warn" : program.length === 0 ? "idle" : s.kind);

  const list = $("progList");
  list.innerHTML = "";
  if (program.length === 0) {
    list.innerHTML = '<li class="empty">No instructions yet.</li>';
  } else {
    program.forEach((ins, i) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="addr">${pad(i)}</span><span>${ins.text}</span>`;
      if (i === s.pc) li.classList.add("on");
      list.appendChild(li);
    });
  }

  $("log").innerHTML = s.log.map((m) => `<li>${m}</li>`).join("");

  $("btnStep").disabled = done;
  $("btnRun").disabled = done || running;
  $("btnPause").disabled = !running;
}

/* ---------- wiring ---------- */
$("src").addEventListener("input", () => {
  init = { regs: Array(NREG).fill(0), mem: Array(NMEM).fill(0) };
  loadSource();
});
$("btnStep").addEventListener("click", () => { stopRun(); step(); render(); });
$("btnRun").addEventListener("click", startRun);
$("btnPause").addEventListener("click", () => { stopRun(); render(); });
$("btnReset").addEventListener("click", reset);
$("speed").addEventListener("input", () => { if (timer) { stopRun(); startRun(); } });
$("btnExample").addEventListener("click", () => { $("src").value = EXAMPLE; $("src").dispatchEvent(new Event("input")); });
$("btnClear").addEventListener("click", () => { $("src").value = ""; $("src").dispatchEvent(new Event("input")); });

buildStaticUI();
$("src").value = EXAMPLE;
loadSource();