#!/usr/bin/env python3
"""
Hermes Terminal Bridge Backend
FastAPI + WebSocket - Shell command execution bridge
Berjalan di port 8000, terpisah dari Apache (port 666)
"""

import subprocess
import asyncio
import os
import signal
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

app = FastAPI(title="Hermes Terminal Bridge")

# Connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}

    async def connect(self, terminal_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[terminal_id] = websocket

    def disconnect(self, terminal_id: str):
        if terminal_id in self.active_connections:
            del self.active_connections[terminal_id]

    async def send_message(self, terminal_id: str, message: str):
        if terminal_id in self.active_connections:
            try:
                await self.active_connections[terminal_id].send_text(message)
            except:
                pass

manager = ConnectionManager()


@app.websocket("/ws/terminal/{terminal_id}")
async def terminal_websocket(websocket: WebSocket, terminal_id: str):
    """WebSocket endpoint untuk terminal streaming"""
    await manager.connect(terminal_id, websocket)

    # Kirim welcome message
    await websocket.send_text("\033[32m✓ Hermes Terminal Bridge connected\033[0m\n")
    await websocket.send_text("\033[90mType shell commands directly. Use /help for info.\033[0m\n\n")

    # History navigasi
    history = []
    history_index = -1

    try:
        while True:
            data = await websocket.receive_text()

            # Ping/pong keepalive
            if data == "PING":
                await websocket.send_text("PONG")
                continue

            # Help
            if data.strip() == "/help":
                help_text = (
                    "\033[36m═══ Hermes Terminal Bridge ═══\033[0m\n"
                    "\n"
                    "\033[33m  Ketik command shell langsung:\033[0m\n"
                    "    ls -la\n"
                    "    cat /etc/hostname\n"
                    "    df -h\n"
                    "    whoami\n"
                    "\n"
                    "\033[33m  Slash commands:\033[0m\n"
                    "    /help    - Tampilkan bantuan ini\n"
                    "    /clear   - Bersihkan terminal\n"
                    "    /pwd     - Cetak working directory\n"
                    "    /cd DIR  - Ganti working directory\n"
                    "    /exit    - Tutup terminal\n"
                    "\n"
                )
                await websocket.send_text(help_text)
                continue

            # Clear
            if data.strip() == "/clear":
                await websocket.send_text("\033c")  # ANSI clear screen
                continue

            # PWD
            if data.strip() == "/pwd":
                await websocket.send_text(f"{os.getcwd()}\n")
                continue

            # CD
            if data.strip().startswith("/cd "):
                target = data.strip()[4:].strip()
                try:
                    os.chdir(target)
                    await websocket.send_text(f"\033[32mcd: {os.getcwd()}\033[0m\n")
                except FileNotFoundError:
                    await websocket.send_text(f"\033[31mcd: Directory not found: {target}\033[0m\n")
                except Exception as e:
                    await websocket.send_text(f"\033[31mcd: {str(e)}\033[0m\n")
                continue

            # Exit
            if data.strip() == "/exit":
                await websocket.send_text("\033[33mClosing terminal...\033[0m\n")
                await websocket.close()
                break

            # Shell command execution
            command = data.strip()
            if not command:
                continue

            # Simpan history
            history.append(command)
            history_index = len(history)

            # Prompt header
            cwd = os.getcwd()
            await websocket.send_text(f"\033[90m$ {command}\033[0m\n")

            # Execute via async subprocess
            try:
                process = await asyncio.create_subprocess_shell(
                    command,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    cwd=cwd,
                    env={**os.environ, "TERM": "xterm-256color"}
                )

                # Stream stdout
                while True:
                    line = await asyncio.wait_for(
                        process.stdout.readline(),
                        timeout=60
                    )
                    if not line:
                        break
                    decoded = line.decode("utf-8", errors="replace")
                    await websocket.send_text(decoded)

                # Stream stderr
                while True:
                    line = await asyncio.wait_for(
                        process.stderr.readline(),
                        timeout=5
                    )
                    if not line:
                        break
                    decoded = line.decode("utf-8", errors="replace")
                    await websocket.send_text(f"\033[31m{decoded}\033[0m")

                await process.wait()

                # Exit code indicator
                if process.returncode != 0:
                    await websocket.send_text(
                        f"\033[90m[exit: {process.returncode}]\033[0m\n"
                    )

            except asyncio.TimeoutError:
                await websocket.send_text(
                    "\033[31m[timeout: command exceeded 60s]\033[0m\n"
                )
                try:
                    process.kill()
                except:
                    pass
            except Exception as e:
                await websocket.send_text(
                    f"\033[31m[error: {str(e)}]\033[0m\n"
                )

    except WebSocketDisconnect:
        manager.disconnect(terminal_id)
    except Exception as e:
        manager.disconnect(terminal_id)


@app.websocket("/ws/shell/{terminal_id}")
async def shell_execute(websocket: WebSocket, terminal_id: str):
    """
    Single-command execution endpoint.
    Client kirim 1 command, terima output, connection ditutup.
    Berguna buat /shell slash command di chat UI.
    """
    await manager.connect(terminal_id, websocket)

    try:
        while True:
            data = await websocket.receive_text()

            if not data.strip():
                continue

            command = data.strip()

            try:
                process = await asyncio.create_subprocess_shell(
                    command,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    cwd=os.getcwd(),
                    env={**os.environ, "TERM": "xterm-256color"}
                )

                stdout, stderr = await asyncio.wait_for(
                    process.communicate(),
                    timeout=60
                )

                output = stdout.decode("utf-8", errors="replace")
                err_output = stderr.decode("utf-8", errors="replace")

                result = {
                    "stdout": output,
                    "stderr": err_output,
                    "exit_code": process.returncode
                }

                await websocket.send_json(result)

            except asyncio.TimeoutError:
                await websocket.send_json({
                    "stdout": "",
                    "stderr": "Command timeout (60s)",
                    "exit_code": -1
                })
            except Exception as e:
                await websocket.send_json({
                    "stdout": "",
                    "stderr": str(e),
                    "exit_code": -1
                })

    except WebSocketDisconnect:
        manager.disconnect(terminal_id)
    except Exception:
        manager.disconnect(terminal_id)


@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "active_terminals": len(manager.active_connections)
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
