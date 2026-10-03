# Instruction Cycle Simulator

**Live simulator:** https://sharonpeter669966-bit.github.io/Instruction-cycle-stimulator/

A live, interactive simulator that shows how a CPU fetches, decodes and executes instructions step by step. Write your own program, press **Next step** or **Run**, and watch the registers, ALU, flags and memory change.

## Links

- [View the code on GitHub](https://github.com/sharonpeter669966-bit/Instruction-cycle-stimulator)
- [Open the live simulator](https://sharonpeter669966-bit.github.io/Instruction-cycle-stimulator/)

## Features

- Type any program, and it is parsed and loaded as you type
- Step through the four stages: Fetch, Decode, Execute, Update PC
- Registers R0 to R3 and 16 cells of data memory, both editable
- ALU panel showing operands, operation and result
- Status flags: Zero (Z), Carry (C), Sign (S)
- Run, Pause, Reset and a speed slider
- Trace log of every stage
- Clear error messages with line numbers

## Supported instructions

| Instruction | What it does |
|---|---|
| `MOV R1, 10` | Put a number or another register into R1 |
| `LOAD R1, 3` | R1 = data memory[3] |
| `STORE R1, 3` | data memory[3] = R1 |
| `ADD R1, R2` | R1 = R1 + R2 (or a number) |
| `SUB R1, R2` | R1 = R1 - R2 (or a number) |
| `AND R1, R2` | Bitwise AND |
| `OR R1, R2` | Bitwise OR |
| `HALT` | Stop execution |

Values are 8-bit (0 to 255) and wrap around at 256. Text after `;` is treated as a comment.

## Example program

```
MOV R1, 10
MOV R2, 5
ADD R1, R2
SUB R1, R2
HALT
```

Final result: R1 = 10, R2 = 5, PC = 04.

## How to run

1. Download or clone this repository.
2. Open `index.html` in a browser (or use the Live Server extension in VS Code).

## Files

| File | Purpose |
|---|---|
| `index.html` | Page structure |
| `style.css` | Styling |
| `script.js` | CPU logic, parser and rendering |

## Built with

HTML, CSS and JavaScript. No libraries or build tools needed.
