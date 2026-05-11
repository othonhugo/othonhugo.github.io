/**
* [Componente] IPC Bridge (User-Land)
*
* Atua como o cliente de comunicação bidirecional entre a Main Thread (UI) e o Kernel (Web Worker).
* Centraliza o gerenciamento de mensagens via `postMessage`, oferecendo uma interface de alto nível
* baseada em eventos (on/emit) para isolar a infraestrutura de renderização das complexidades do Worker.
*/
var Bridge = class {
	/** Instância do Web Worker que hospeda o Kernel. */
	worker;
	/** Mapa de ouvintes registrados na Main Thread para eventos do Kernel. */
	listeners = /* @__PURE__ */ new Map();
	constructor() {
		/**
		* Inicialização do Kernel em ambiente isolado.
		* O sufixo `?worker` orienta o bundler (Vite) a processar o entrypoint como Worker.
		*/
		this.worker = new Worker(new URL(
			/* @vite-ignore */
			"/kernel.js",
			"" + import.meta.url
		), { type: "module" });
		this.listenToWorker();
	}
	/**
	* Estabelece o receptor de mensagens brutas do Worker.
	* Realiza a deserialização e despacho para os handlers registrados.
	*/
	listenToWorker() {
		this.worker.addEventListener("message", (event) => {
			const { event: eventName, payload } = event.data;
			if (!eventName) return;
			const handlers = this.listeners.get(eventName);
			if (handlers) handlers.forEach((fn) => fn(payload));
		});
	}
	/**
	* Registra um interesse em eventos específicos emitidos pelo Kernel.
	* @param event - Identificador do evento.
	* @param callback - Função executada no recebimento do payload.
	*/
	on(event, callback) {
		if (!this.listeners.has(event)) this.listeners.set(event, []);
		this.listeners.get(event).push(callback);
	}
	/**
	* Remove um ouvinte do barramento.
	* Procedimento mandatório para evitar vazamento de memória em closures temporárias.
	* @param event - Identificador do evento.
	* @param callback - Instância da função a ser removida.
	*/
	off(event, callback) {
		const handlers = this.listeners.get(event);
		if (handlers) this.listeners.set(event, handlers.filter((fn) => fn !== callback));
	}
	/**
	* Despacha uma intenção (intent) da UI para processamento no Kernel.
	* @param event - Identificador do evento/comando.
	* @param payload - Dados de acompanhamento.
	*/
	emit(event, payload) {
		this.worker.postMessage({
			event,
			payload
		});
	}
};
/** Instância singleton da Bridge, garantindo um canal único de comunicação sistêmica. */
var bridge = new Bridge();
var IPC_EVENTS = {
	/**
	* Emitido pelo Kernel quando o estado global (janelas, desktop) sofre mutação.
	* Payload: IStateSnapshot
	*/
	STATE_UPDATED: "kernel:state-updated",
	/** Solicita que uma janela ganhe foco e suba no Z-index. */
	APP_REQUEST_FOCUS: "app:request-focus",
	/** Solicita a abertura de um novo processo/aplicativo. */
	APP_REQUEST_OPEN: "app:request-open",
	/** Realiza o revezamento de foco ou minimização de um grupo de janelas. */
	APP_REQUEST_TOGGLE: "app:request-toggle",
	/** Altera as coordenadas (x, y) de uma janela em tempo real. */
	APP_REQUEST_MOVE: "app:request-move",
	/** Altera as dimensões (width, height) de uma janela. */
	APP_REQUEST_RESIZE: "app:request-resize",
	/** Finaliza um processo e remove sua instância da UI. */
	APP_REQUEST_CLOSE: "app:request-close",
	/** Oculta a janela da área de trabalho, mantendo o processo vivo. */
	APP_REQUEST_MINIMIZE: "app:request-minimize",
	/** Expande a janela para preencher toda a viewport disponível. */
	APP_REQUEST_MAXIMIZE: "app:request-maximize",
	/** Retorna a janela ao seu tamanho e posição anteriores ao Maximizar/Minimizar. */
	APP_REQUEST_RESTORE: "app:request-restore",
	/** Solicita o conteúdo bruto de um arquivo via caminho absoluto. */
	FS_REQUEST_READ: "fs:request-read",
	/** Resposta do Kernel contendo os dados solicitados de um arquivo. */
	FS_RESPONSE_READ: "fs:response-read",
	/** Solicita a listagem de entradas (arquivos/pastas) de um diretório. */
	FS_REQUEST_READDIR: "fs:request-readdir",
	/** Resposta do Kernel contendo o array de INode do diretório solicitado. */
	FS_RESPONSE_READDIR: "fs:response-readdir",
	/** Envia uma string de comando para ser interpretada pelo Shell no Kernel. */
	SHELL_REQUEST_EXEC: "shell:request-exec",
	/** Retorna a saída (STDOUT/STDERR) e o novo diretório de trabalho (CWD). */
	SHELL_RESPONSE_EXEC: "shell:response-exec",
	/** Solicita o envio de uma mensagem de correio eletrônico. */
	MAIL_REQUEST_SEND: "mail:request-send",
	/** Resposta do Kernel sinalizando sucesso ou falha no despacho do email. */
	MAIL_RESPONSE_SEND: "mail:response-send"
};
var SoundManager = class {
	ctx = null;
	init() {
		if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
		return this.ctx;
	}
	beep(freq, duration, type = "square", volume = .1) {
		const ctx = this.init();
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = type;
		osc.frequency.setValueAtTime(freq, ctx.currentTime);
		gain.gain.setValueAtTime(volume, ctx.currentTime);
		gain.gain.exponentialRampToValueAtTime(1e-4, ctx.currentTime + duration);
		osc.connect(gain);
		gain.connect(ctx.destination);
		osc.start();
		osc.stop(ctx.currentTime + duration);
	}
	playOpen() {
		this.beep(600, .1, "square");
		setTimeout(() => this.beep(800, .1, "square"), 50);
	}
	playClose() {
		this.beep(400, .1, "square");
		setTimeout(() => this.beep(200, .1, "square"), 50);
	}
	playMinimize() {
		this.beep(500, .2, "sine");
	}
	playMaximize() {
		this.beep(700, .2, "sine");
	}
	playRestore() {
		this.playMaximize();
	}
	playClick() {
		this.beep(1e3, .05, "triangle", .05);
	}
};
var soundManager = new SoundManager();
var ContextMenu = class ContextMenu {
	/** Instância única do componente (Padrão Singleton). */
	static instance = null;
	/** Referência ao elemento DOM do menu atualmente visível. */
	container = null;
	/** Referência ao elemento pai onde o menu será injetado. */
	parent = null;
	constructor() {
		/**
		* Registra ouvintes globais para ocultação automática do menu
		* em interações fora de sua área ou ao pressionar Escape.
		*/
		window.addEventListener("mousedown", () => this.hide());
		window.addEventListener("keydown", (event) => {
			if (event.key === "Escape") this.hide();
		});
	}
	/**
	* Recupera a instância global do ContextMenu.
	* @returns Instância ativa do Singleton.
	*/
	static getInstance() {
		if (!this.instance) this.instance = new ContextMenu();
		return this.instance;
	}
	/**
	* Vincula o componente a um elemento pai para injeção DOM.
	* @param parent - Elemento raiz do sistema (Compositor Container).
	*/
	init(parent) {
		this.parent = parent;
	}
	/**
	* Monta e exibe um menu de contexto nas coordenadas solicitadas.
	* Realiza o cálculo de colisão para garantir que o menu permaneça visível.
	* @param options - Configurações de posicionamento e itens de menu.
	*/
	show(options) {
		if (!this.parent) return;
		this.hide();
		this.container = document.createElement("div");
		this.container.className = "context-menu";
		Object.assign(this.container.style, {
			position: "absolute",
			left: `${options.x}px`,
			top: `${options.y}px`,
			backgroundColor: "#c0c0c0",
			border: "2px solid #fff",
			borderRightColor: "#808080",
			borderBottomColor: "#808080",
			boxShadow: "2px 2px 0 rgba(0,0,0,0.5)",
			zIndex: "10000",
			padding: "2px",
			minWidth: "150px",
			userSelect: "none"
		});
		options.items.forEach((item) => {
			if (item.separator) {
				const sep = document.createElement("div");
				sep.style.height = "1px";
				sep.style.backgroundColor = "#808080";
				sep.style.borderBottom = "1px solid #fff";
				sep.style.margin = "4px 2px";
				this.container?.appendChild(sep);
				return;
			}
			const el = document.createElement("div");
			el.className = "menu-item";
			el.textContent = item.label || "";
			Object.assign(el.style, {
				padding: "4px 12px",
				fontSize: "11px",
				cursor: "pointer",
				color: item.disabled ? "#808080" : "#000",
				pointerEvents: item.disabled ? "none" : "auto",
				display: "flex",
				alignItems: "center"
			});
			if (!item.disabled && item.action) {
				el.addEventListener("mouseenter", () => {
					el.style.backgroundColor = "#000080";
					el.style.color = "#fff";
				});
				el.addEventListener("mouseleave", () => {
					el.style.backgroundColor = "transparent";
					el.style.color = "#000";
				});
				el.addEventListener("mousedown", (event) => {
					event.stopPropagation();
					soundManager.playClick();
					if (item.action) item.action();
					this.hide();
				});
			}
			this.container?.appendChild(el);
		});
		this.parent.appendChild(this.container);
		const rect = this.container.getBoundingClientRect();
		if (rect.right > window.innerWidth) this.container.style.left = `${options.x - rect.width}px`;
		if (rect.bottom > window.innerHeight) this.container.style.top = `${options.y - rect.height}px`;
	}
	/**
	* Remove o menu ativo do DOM e libera recursos de memória.
	*/
	hide() {
		if (this.container) {
			this.container.remove();
			this.container = null;
		}
	}
};
function createOsApiForProcess(pid) {
	return {
		pid,
		/**
		* Sinaliza ao Kernel a necessidade de foco.
		* O processo apenas "clama" pelo foco; a decisão final de Z-index cabe ao ProcessManager.
		*/
		requestFocus: () => {
			bridge.emit(IPC_EVENTS.APP_REQUEST_FOCUS, pid);
		},
		/**
		* Syscall assíncrona para leitura de dados.
		* Implementa mecanismo de Request/Response utilizando UUID para correlacionar mensagens IPC.
		*/
		readFile: (path) => {
			return new Promise((resolve) => {
				const requestId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString();
				const handler = (response) => {
					if (response.requestId === requestId) {
						bridge.off(IPC_EVENTS.FS_RESPONSE_READ, handler);
						resolve(response.content);
					}
				};
				bridge.on(IPC_EVENTS.FS_RESPONSE_READ, handler);
				bridge.emit(IPC_EVENTS.FS_REQUEST_READ, {
					pid,
					requestId,
					path
				});
			});
		},
		/**
		* Syscall assíncrona para listagem de diretório.
		*/
		readDir: (path) => {
			return new Promise((resolve) => {
				const requestId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString();
				const handler = (response) => {
					if (response.requestId === requestId) {
						bridge.off(IPC_EVENTS.FS_RESPONSE_READDIR, handler);
						resolve(response.items);
					}
				};
				bridge.on(IPC_EVENTS.FS_RESPONSE_READDIR, handler);
				bridge.emit(IPC_EVENTS.FS_REQUEST_READDIR, {
					pid,
					requestId,
					path
				});
			});
		},
		/**
		* Repassa requisição de abertura de processo para o Kernel.
		*/
		spawnProcess: (payload) => {
			bridge.emit(IPC_EVENTS.APP_REQUEST_OPEN, payload);
		},
		/**
		* Aciona o Singleton do ContextMenu na Main Thread.
		*/
		showContextMenu: (options) => {
			ContextMenu.getInstance().show(options);
		},
		/**
		* Encaminha instrução de texto para execução headless no Shell do Kernel.
		*/
		executeCommand: (command) => {
			return new Promise((resolve) => {
				const handler = (response) => {
					if (response.pid === pid) {
						bridge.off(IPC_EVENTS.SHELL_RESPONSE_EXEC, handler);
						resolve({
							output: response.output,
							cwd: response.cwd
						});
					}
				};
				bridge.on(IPC_EVENTS.SHELL_RESPONSE_EXEC, handler);
				bridge.emit(IPC_EVENTS.SHELL_REQUEST_EXEC, {
					pid,
					command
				});
			});
		},
		/**
		* Syscall para envio de email.
		* Sincroniza a intenção de contato com o Kernel.
		*/
		sendMail: (payload) => {
			return new Promise((resolve) => {
				const handler = (response) => {
					if (response.pid === pid) {
						bridge.off(IPC_EVENTS.MAIL_RESPONSE_SEND, handler);
						resolve({ success: response.success });
					}
				};
				bridge.on(IPC_EVENTS.MAIL_RESPONSE_SEND, handler);
				bridge.emit(IPC_EVENTS.MAIL_REQUEST_SEND, {
					pid,
					...payload
				});
			});
		}
	};
}
var OsApp = class extends HTMLElement {
	shadow;
	osApi;
	constructor() {
		super();
		this.shadow = this.attachShadow({ mode: "closed" });
		const baseStyle = document.createElement("style");
		baseStyle.textContent = `
      :host { 
        display: block; 
        width: 100%; 
        height: 100%; 
        overflow: hidden; 
      }
    `;
		this.shadow.appendChild(baseStyle);
	}
	attachApi(api) {
		this.osApi = api;
		this.render();
	}
};
var TerminalApp = class extends OsApp {
	/** Buffer circular para armazenamento de comandos executados na sessão. */
	history = [];
	/** Índice de navegação no histórico. */
	historyIndex = -1;
	/** Representação local do diretório de trabalho atual, sincronizado com o Shell do Kernel. */
	currentCWD = "/";
	/**
	* Inicializa o ambiente de terminal.
	* Monta a estrutura de buffer de log, linha de prompt reativa e input de comandos.
	*/
	render() {
		if (!this.osApi) return;
		const style = document.createElement("style");
		style.textContent = `
      .terminal-container {
        background-color: #0c0c0c;
        color: #00ff00;
        font-family: 'Courier New', Courier, monospace;
        height: 100%;
        padding: 10px;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        font-size: 13px;
        text-shadow: 0 0 5px rgba(0, 255, 0, 0.5);
      }
      .output { flex: 1; overflow-y: auto; margin-bottom: 10px; white-space: pre-wrap; }
      .input-line { display: flex; align-items: center; }
      .prompt { margin-right: 8px; color: #fff; font-weight: bold; }
      input {
        background: transparent;
        color: #00ff00;
        border: none;
        outline: none;
        font-family: inherit;
        flex: 1;
        font-size: inherit;
      }
    `;
		const container = document.createElement("div");
		container.className = "terminal-container";
		const scroller = document.createElement("div");
		scroller.className = "output";
		const log = document.createElement("div");
		log.style.whiteSpace = "pre-wrap";
		log.textContent = `ottoOS [Versão 1.0.0] (c) 2026 Othon Hugo. Todos os direitos reservados.\n\nDigite 'help' para comandos.\n`;
		scroller.appendChild(log);
		const inputLine = document.createElement("div");
		inputLine.className = "input-line";
		const prompt = document.createElement("div");
		prompt.className = "prompt";
		prompt.textContent = `guest@othon:${this.currentCWD}$`;
		const input = document.createElement("input");
		input.type = "text";
		input.spellcheck = false;
		input.autocomplete = "off";
		inputLine.appendChild(prompt);
		inputLine.appendChild(input);
		scroller.appendChild(inputLine);
		/** Solicita foco ao sistema e redireciona ao input interno. */
		container.addEventListener("mousedown", () => {
			this.osApi.requestFocus();
			setTimeout(() => input.focus(), 10);
		});
		/**
		* Processador de teclado para o Terminal.
		* Gerencia a execução de comandos (Enter) e navegação no histórico (Setas).
		*/
		input.addEventListener("keydown", async (event) => {
			if (event.key === "Enter") {
				const rawCmd = input.value;
				const cmd = rawCmd.trim();
				input.value = "";
				const historyLine = document.createElement("div");
				historyLine.className = "input-line";
				historyLine.innerHTML = `<span class="prompt">guest@othon:${this.currentCWD}$</span> <span>${rawCmd}</span>`;
				log.appendChild(historyLine);
				if (cmd) {
					this.history.push(cmd);
					this.historyIndex = this.history.length;
				}
				const response = await this.osApi.executeCommand(cmd);
				if (response.output === "__CLEAR__") log.innerHTML = "";
				else if (response.output) {
					const outputLine = document.createElement("div");
					outputLine.textContent = response.output;
					log.appendChild(outputLine);
				}
				this.currentCWD = response.cwd;
				prompt.textContent = `guest@othon:${this.currentCWD}$`;
				scroller.scrollTop = scroller.scrollHeight;
				input.focus();
			} else if (event.key === "ArrowUp") {
				if (this.historyIndex > 0) {
					this.historyIndex--;
					input.value = this.history[this.historyIndex];
				}
				event.preventDefault();
			} else if (event.key === "ArrowDown") {
				if (this.historyIndex < this.history.length - 1) {
					this.historyIndex++;
					input.value = this.history[this.historyIndex];
				} else {
					this.historyIndex = this.history.length;
					input.value = "";
				}
				event.preventDefault();
			}
		});
		container.appendChild(scroller);
		this.shadow.appendChild(style);
		this.shadow.appendChild(container);
		setTimeout(() => input.focus(), 100);
	}
};
customElements.define("os-terminal", TerminalApp);
var ReaderApp = class extends OsApp {
	/** Referência ao container principal no Shadow DOM. */
	container;
	/**
	* Inicializa o ambiente visual do leitor.
	* Aplica o design system Monospace e configura a barra de menu superior.
	*/
	render() {
		if (!this.osApi) return;
		this.container = document.createElement("div");
		this.container.className = "reader-container";
		const menuBar = document.createElement("div");
		menuBar.className = "menu-bar";
		menuBar.innerHTML = `
      <div class="menu-item">Arquivo</div>
      <div class="menu-item">Editar</div>
      <div class="menu-item" id="help-menu">Ajuda</div>
    `;
		const contentArea = document.createElement("div");
		contentArea.className = "reader-content";
		const style = document.createElement("style");
		style.textContent = `
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: #c0c0c0;
      }
      .reader-container {
        display: flex;
        flex-direction: column;
        height: 100%;
      }
      .menu-bar {
        display: flex;
        background: #c0c0c0;
        border-bottom: 1px solid #808080;
        padding: 2px;
        gap: 10px;
        font-family: 'Courier New', Courier, monospace;
        font-size: 12px;
      }
      .menu-item {
        padding: 2px 8px;
        cursor: default;
      }
      .menu-item:hover {
        background: #000080;
        color: #fff;
      }
      .reader-content {
        flex: 1;
        padding: 12px;
        line-height: 1.5;
        white-space: pre-wrap;
        background: #fff;
        color: #000;
        font-family: 'Courier New', Courier, monospace;
        overflow: auto;
        cursor: text;
      }
      .loading {
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100%;
        color: #888;
      }
    `;
		menuBar.querySelector("#help-menu")?.addEventListener("click", (event) => {
			event.stopPropagation();
			this.osApi.showContextMenu({
				x: event.target.getBoundingClientRect().left,
				y: event.target.getBoundingClientRect().bottom,
				items: [
					{
						label: "📧 Contato",
						action: () => {
							this.osApi.spawnProcess({
								appId: "mail",
								title: "Contato Otto OS"
							});
						}
					},
					{ separator: true },
					{
						label: "Sobre o Reader...",
						action: () => alert("Otto Reader v1.0")
					}
				]
			});
		});
		contentArea.addEventListener("mousedown", () => {
			this.osApi.requestFocus();
		});
		this.container.appendChild(menuBar);
		this.container.appendChild(contentArea);
		this.shadow.appendChild(style);
		this.shadow.appendChild(this.container);
		this.container = contentArea;
		const path = this.getAttribute("path");
		if (path) this.loadFile(path);
	}
	/**
	* Monitora alterações no atributo 'path' para recarregamento dinâmico.
	*/
	static get observedAttributes() {
		return ["path"];
	}
	/**
	* Reage a mudanças de path injetadas pelo Compositor.
	*/
	async attributeChangedCallback(name, oldValue, newValue) {
		if (name === "path" && newValue && newValue !== oldValue && this.osApi) await this.loadFile(newValue);
	}
	/**
	* Realiza a leitura assíncrona do conteúdo do arquivo.
	* Utiliza a OsApi para mediar o acesso ao VFS no Kernel.
	* @param path - Caminho absoluto do arquivo.
	*/
	async loadFile(path) {
		if (!this.container) return;
		this.container.innerHTML = "<div class=\"loading\">Lendo arquivo...</div>";
		try {
			const content = await this.osApi.readFile(path);
			if (content === null) this.container.innerHTML = `<div style="color: #ff4444">Erro: Não foi possível ler o arquivo em ${path}</div>`;
			else this.container.textContent = content;
		} catch (error) {
			this.container.innerHTML = `<div style="color: #ff4444">Falha crítica no sistema de arquivos.</div>`;
		}
	}
};
customElements.define("os-reader", ReaderApp);
var ExplorerApp = class extends OsApp {
	/** Caminho do diretório atualmente visualizado. */
	currentPath = "/desktop";
	/** Lista de nós (arquivos/pastas) carregados do diretório atual. */
	items = [];
	/** Referências a elementos DOM internos (Shadow DOM). */
	container;
	header;
	sidebar;
	mainView;
	statusBar;
	/**
	* Constrói a estrutura visual e injeta os estilos do aplicativo.
	* Inicializa a navegação baseada no atributo 'path' ou no diretório padrão.
	*/
	render() {
		this.container = document.createElement("div");
		this.container.className = "explorer-container";
		this.header = document.createElement("div");
		this.header.className = "explorer-header";
		this.sidebar = document.createElement("div");
		this.sidebar.className = "explorer-sidebar";
		this.mainView = document.createElement("div");
		this.mainView.className = "explorer-main";
		this.statusBar = document.createElement("div");
		this.statusBar.className = "explorer-footer";
		this.container.appendChild(this.header);
		const body = document.createElement("div");
		body.className = "explorer-body";
		body.appendChild(this.sidebar);
		body.appendChild(this.mainView);
		this.container.appendChild(body);
		this.container.appendChild(this.statusBar);
		const style = document.createElement("style");
		style.textContent = `
      :host {
        display: block;
        height: 100%;
        font-family: 'Courier New', Courier, monospace;
        background: #c0c0c0;
        color: #000;
        user-select: none;
      }

      .explorer-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        border: 2px solid #fff;
        border-right-color: #808080;
        border-bottom-color: #808080;
      }

      .explorer-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 8px;
        background: #c0c0c0;
        border-bottom: 2px solid #808080;
      }

      .address-bar {
        flex: 1;
        background: #fff;
        border: 2px solid #808080;
        border-right-color: #dfdfdf;
        border-bottom-color: #dfdfdf;
        padding: 2px 6px;
        font-size: 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .retro-btn {
        background: #c0c0c0;
        border: 2px solid #fff;
        border-right-color: #808080;
        border-bottom-color: #808080;
        padding: 2px 8px;
        font-size: 12px;
        cursor: pointer;
        font-family: inherit;
      }

      .retro-btn:active {
        border: 2px solid #808080;
        border-right-color: #fff;
        border-bottom-color: #fff;
      }

      .explorer-body {
        display: flex;
        flex: 1;
        overflow: hidden;
      }

      .explorer-sidebar {
        width: 140px;
        background: #dfdfdf;
        border-right: 2px solid #808080;
        padding: 8px;
        overflow-y: auto;
      }

      .sidebar-item {
        padding: 4px;
        cursor: pointer;
        font-size: 12px;
        border: 1px solid transparent;
      }

      .sidebar-item:hover {
        background: #000080;
        color: #fff;
      }

      .explorer-main {
        flex: 1;
        background: #fff;
        overflow-y: auto;
        padding: 0;
      }

      .file-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }

      .file-table th {
        position: sticky;
        top: 0;
        background: #c0c0c0;
        text-align: left;
        padding: 4px 8px;
        border-right: 1px solid #808080;
        border-bottom: 2px solid #808080;
        font-weight: normal;
        z-index: 10;
      }

      .file-table td {
        padding: 4px 8px;
        cursor: pointer;
        white-space: nowrap;
        border-right: 1px solid #efefef;
      }

      .file-table tr:hover td {
        background: #000080;
        color: #fff;
      }

      .explorer-footer {
        height: 24px;
        background: #c0c0c0;
        border-top: 2px solid #fff;
        padding: 0 8px;
        font-size: 11px;
        display: flex;
        align-items: center;
        border-bottom: 2px solid #808080;
      }

      .icon {
        margin-right: 6px;
      }
    `;
		this.shadow.appendChild(style);
		this.shadow.appendChild(this.container);
		const initialPath = this.getAttribute("path") || "/desktop";
		this.navigateTo(initialPath);
	}
	/**
	* Monitora atributos externos para permitir Deep Linking via Compositor.
	*/
	static get observedAttributes() {
		return ["path"];
	}
	/**
	* Reage a mudanças no caminho de navegação injetado pelo sistema.
	*/
	async attributeChangedCallback(name, oldValue, newValue) {
		if (name === "path" && newValue && newValue !== oldValue && this.osApi) await this.navigateTo(newValue);
	}
	/**
	* Realiza a transição para um novo diretório.
	* Aciona a Syscall readDir e atualiza todos os componentes visuais.
	* @param path - Caminho alvo no VFS.
	*/
	async navigateTo(path) {
		this.currentPath = path;
		this.renderHeader();
		this.renderSidebar();
		this.mainView.innerHTML = "<div style=\"padding: 10px\">Lendo diretório...</div>";
		try {
			this.items = await this.osApi.readDir(path);
			this.renderMain();
			this.statusBar.textContent = `${this.items.length} objeto(s)`;
		} catch (error) {
			this.mainView.innerHTML = `<div style="color: red; padding: 10px">Erro ao acessar ${path}</div>`;
		}
	}
	/**
	* Renderiza a barra de ferramentas superior com botões de navegação e barra de endereços.
	*/
	renderHeader() {
		this.header.innerHTML = "";
		const backBtn = document.createElement("button");
		backBtn.className = "retro-btn";
		backBtn.textContent = "←";
		backBtn.onclick = () => {
			soundManager.playClick();
			const parts = this.currentPath.split("/").filter((p) => p);
			if (parts.length > 0) {
				parts.pop();
				this.navigateTo("/" + parts.join("/"));
			}
		};
		const addressBar = document.createElement("div");
		addressBar.className = "address-bar";
		addressBar.textContent = this.currentPath;
		const searchBar = document.createElement("input");
		searchBar.placeholder = "Buscar...";
		searchBar.style.width = "100px";
		searchBar.style.fontSize = "10px";
		searchBar.style.border = "2px solid #808080";
		searchBar.style.fontFamily = "inherit";
		searchBar.oninput = (event) => this.filterItems(event.target.value);
		this.header.appendChild(backBtn);
		this.header.appendChild(addressBar);
		this.header.appendChild(searchBar);
	}
	/**
	* Renderiza a barra lateral com locais favoritos e unidades de sistema.
	*/
	renderSidebar() {
		this.sidebar.innerHTML = "";
		[{
			title: "SISTEMA",
			items: [{
				name: "💿 Disco Local",
				path: "/"
			}]
		}, {
			title: "FAVORITOS",
			items: [{
				name: "📍 Desktop",
				path: "/desktop"
			}, {
				name: "📁 Documentos",
				path: "/documents"
			}]
		}].forEach((section) => {
			const title = document.createElement("div");
			title.style.fontSize = "9px";
			title.style.color = "#808080";
			title.style.marginTop = "12px";
			title.style.marginBottom = "4px";
			title.style.fontWeight = "bold";
			title.textContent = section.title;
			this.sidebar.appendChild(title);
			section.items.forEach((loc) => {
				const item = document.createElement("div");
				item.className = "sidebar-item";
				item.textContent = loc.name;
				item.onclick = () => {
					soundManager.playClick();
					this.navigateTo(loc.path);
				};
				this.sidebar.appendChild(item);
			});
		});
	}
	/**
	* Renderiza a grade de arquivos em formato de tabela.
	* @param filter - Termo opcional para filtragem de itens.
	*/
	renderMain(filter = "") {
		this.mainView.innerHTML = "";
		const table = document.createElement("table");
		table.className = "file-table";
		table.innerHTML = `
      <thead>
        <tr>
          <th style="width: 50%">Nome</th>
          <th style="width: 20%">Tipo</th>
          <th style="width: 30%">Tamanho</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
		const tbody = table.querySelector("tbody");
		this.items.filter((item) => item.name.toLowerCase().includes(filter.toLowerCase())).forEach((item) => {
			const tr = document.createElement("tr");
			const isDir = item.type === "directory";
			tr.innerHTML = `
        <td><span class="icon">${isDir ? "📁" : "📄"}</span>${item.name}</td>
        <td>${isDir ? "Pasta" : "Arquivo"}</td>
        <td>${isDir ? "--" : (item.size || 0) + " bytes"}</td>
      `;
			tr.ondblclick = () => {
				soundManager.playClick();
				this.handleItemClick(item);
			};
			tr.oncontextmenu = (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.osApi.showContextMenu({
					x: event.clientX,
					y: event.clientY,
					items: [
						{
							label: "📂 Abrir",
							action: () => this.handleItemClick(item)
						},
						{
							label: "🪟 Abrir em nova janela",
							action: () => {
								const fullPath = item.path === "/" ? `/${item.name}` : `${this.currentPath}/${item.name}`;
								window.open(`${window.location.origin}${window.location.pathname}#${fullPath}`, "_blank");
							}
						},
						{ separator: true },
						{
							label: "✂️ Recortar",
							disabled: true,
							action: () => {}
						},
						{
							label: "📋 Copiar",
							disabled: true,
							action: () => {}
						},
						{ separator: true },
						{
							label: "🗑️ Excluir",
							disabled: true,
							action: () => {}
						}
					]
				});
			};
			tbody.appendChild(tr);
		});
		this.mainView.appendChild(table);
	}
	/**
	* Aplica filtro reativo na visualização de arquivos.
	*/
	filterItems(query) {
		this.renderMain(query);
	}
	/**
	* Determina a ação de abertura baseando-se no tipo de Inode.
	* Pastas acionam navegação interna; arquivos acionam a abertura de novos processos.
	* @param item - Nó selecionado pelo usuário.
	*/
	handleItemClick(item) {
		const fullPath = this.currentPath === "/" ? `/${item.name}` : `${this.currentPath}/${item.name}`;
		if (item.type === "directory") this.navigateTo(fullPath);
		else {
			let appId = "reader";
			if (item.name.endsWith(".exe")) appId = "terminal";
			this.osApi.spawnProcess({
				appId,
				title: item.name,
				path: fullPath
			});
		}
	}
};
customElements.define("os-explorer", ExplorerApp);
var MailApp = class extends OsApp {
	fromInput;
	subjectInput;
	bodyInput;
	sendBtn;
	statusLine;
	render() {
		if (!this.osApi) return;
		const style = document.createElement("style");
		style.textContent = `
      :host {
        display: block;
        height: 100%;
        background: #c0c0c0;
        font-family: 'Courier New', Courier, monospace;
      }
      .mail-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        padding: 10px;
        box-sizing: border-box;
        gap: 10px;
      }
      .field-row {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      label {
        width: 60px;
        font-size: 12px;
        font-weight: bold;
      }
      input, textarea {
        flex: 1;
        background: #fff;
        border: 2px solid #808080;
        border-right-color: #dfdfdf;
        border-bottom-color: #dfdfdf;
        padding: 4px;
        font-family: inherit;
        font-size: 12px;
        outline: none;
      }
      input[readonly] {
        background: #dfdfdf;
        color: #555;
      }
      textarea {
        resize: none;
        flex: 1;
      }
      .toolbar {
        display: flex;
        justify-content: flex-end;
        padding: 5px 0;
        border-top: 1px solid #808080;
      }
      .retro-btn {
        background: #c0c0c0;
        border: 2px solid #fff;
        border-right-color: #808080;
        border-bottom-color: #808080;
        padding: 4px 15px;
        font-size: 12px;
        cursor: pointer;
        font-family: inherit;
      }
      .retro-btn:active {
        border: 2px solid #808080;
        border-right-color: #fff;
        border-bottom-color: #fff;
      }
      .status {
        font-size: 10px;
        color: #000080;
      }
      /* Modal de Sucesso */
      .modal-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.2);
        display: none;
        justify-content: center;
        align-items: center;
        z-index: 1000;
      }
      .modal {
        background: #c0c0c0;
        border: 2px solid #fff;
        border-right-color: #808080;
        border-bottom-color: #808080;
        box-shadow: 2px 2px 10px rgba(0,0,0,0.5);
        width: 200px;
        padding: 15px;
        text-align: center;
      }
      .modal-title {
        background: #000080;
        color: #fff;
        font-size: 11px;
        font-weight: bold;
        padding: 2px 4px;
        text-align: left;
        margin: -15px -15px 15px -15px;
      }
      .modal-body {
        font-size: 12px;
        margin-bottom: 15px;
      }
    `;
		const container = document.createElement("div");
		container.className = "mail-container";
		container.innerHTML = `
      <div class="field-row">
        <label>De:</label>
        <input type="text" id="from" placeholder="seu-email@exemplo.com" />
      </div>
      <div class="field-row">
        <label>Para:</label>
        <input type="text" value="othon@otto-os.local" readonly />
      </div>
      <div class="field-row">
        <label>Assunto:</label>
        <input type="text" id="subject" placeholder="Assunto da mensagem..." />
      </div>
      <textarea id="body" placeholder="Escreva sua mensagem aqui..."></textarea>
      <div class="toolbar">
        <div id="status" class="status" style="flex: 1; display: flex; align-items: center;"></div>
        <button id="send" class="retro-btn">Enviar</button>
      </div>

      <!-- Modal de Sucesso -->
      <div id="success-modal" class="modal-overlay">
        <div class="modal">
          <div class="modal-title">Otto Mail</div>
          <div class="modal-body">Mensagem enviada com sucesso!</div>
          <button id="modal-ok" class="retro-btn">OK</button>
        </div>
      </div>
    `;
		this.fromInput = container.querySelector("#from");
		this.subjectInput = container.querySelector("#subject");
		this.bodyInput = container.querySelector("#body");
		this.sendBtn = container.querySelector("#send");
		this.statusLine = container.querySelector("#status");
		const modal = container.querySelector("#success-modal");
		const modalOk = container.querySelector("#modal-ok");
		modalOk.onclick = () => {
			modal.style.display = "none";
			soundManager.playClick();
		};
		this.showSuccessModal = () => {
			modal.style.display = "flex";
		};
		this.sendBtn.onclick = () => this.handleSend();
		this.shadow.appendChild(style);
		this.shadow.appendChild(container);
	}
	showSuccessModal;
	/**
	* Valida e despacha o email via OsApi.
	* Garante preenchimento completo, formato de email válido e trava de UI.
	*/
	async handleSend() {
		const from = this.fromInput.value.trim();
		const subject = this.subjectInput.value.trim();
		const body = this.bodyInput.value.trim();
		if (!from || !subject || !body) {
			this.showStatus("Todos os campos são obrigatórios!", "#ff0000");
			soundManager.playClick();
			return;
		}
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) {
			this.showStatus("Formato de e-mail inválido!", "#ff0000");
			soundManager.playClick();
			return;
		}
		this.setFormState(true);
		this.showStatus("Enviando...", "#000080");
		soundManager.playClick();
		try {
			if ((await this.osApi.sendMail({
				subject,
				body
			})).success) {
				this.showSuccessModal();
				this.showStatus("Pronto.", "#008000");
				this.clearForm();
				this.setFormState(false);
			} else throw new Error("Falha no envio");
		} catch (error) {
			this.showStatus("Erro ao enviar. Tente novamente.", "#ff0000");
			this.setFormState(false);
		}
	}
	showStatus(text, color) {
		this.statusLine.textContent = text;
		this.statusLine.style.color = color;
	}
	setFormState(disabled) {
		this.fromInput.disabled = disabled;
		this.subjectInput.disabled = disabled;
		this.bodyInput.disabled = disabled;
		this.sendBtn.disabled = disabled;
	}
	clearForm() {
		this.fromInput.value = "";
		this.subjectInput.value = "";
		this.bodyInput.value = "";
	}
};
customElements.define("os-mail", MailApp);
var APP_REGISTRY = {
	terminal: "os-terminal",
	reader: "os-reader",
	explorer: "os-explorer",
	mail: "os-mail"
};
var WindowCompositor = class {
	/** Referência ao elemento pai onde as janelas são injetadas. */
	container;
	/** Mapa de cache para instâncias DOM de janelas ativas. */
	renderedWindows = /* @__PURE__ */ new Map();
	/** Cache de metadados de estado para referência rápida em eventos de UI. */
	windowSnapshots = /* @__PURE__ */ new Map();
	/** Lista de aplicativos fixados na barra de tarefas (Dock). */
	fixedApps = [
		{
			appId: "terminal",
			icon: ">_",
			title: "Terminal"
		},
		{
			appId: "explorer",
			icon: "📁",
			title: "Explorer"
		},
		{
			appId: "mail",
			icon: "📧",
			title: "Mail"
		}
	];
	/** Estado transiente para operações de arraste. */
	draggingState = {
		pid: null,
		offsetX: 0,
		offsetY: 0
	};
	/** Estado transiente para operações de redimensionamento. */
	resizingState = {
		pid: null,
		startWidth: 0,
		startHeight: 0,
		startMouseX: 0,
		startMouseY: 0
	};
	/** Elemento visual temporário usado para feedback de arraste/resize (Ghosting). */
	ghostElement = null;
	constructor(containerId) {
		const el = document.getElementById(containerId);
		if (!el) throw new Error(`Compositor Container #${containerId} não encontrado no DOM.`);
		this.container = el;
		ContextMenu.getInstance().init(this.container);
		this.setupGlobalMouseListeners();
		this.setupContextMenu();
		this.subscribeToState();
		this.renderTaskbar({
			windows: [],
			desktopItems: []
		});
	}
	/**
	* Configura interceptadores de menus de contexto globais para o desktop.
	*/
	setupContextMenu() {
		this.container.addEventListener("contextmenu", (event) => {
			event.preventDefault();
			if (event.target === this.container || event.target.classList.contains("desktop-wallpaper")) ContextMenu.getInstance().show({
				x: event.clientX,
				y: event.clientY,
				items: [
					{
						label: "🆕 Novo Arquivo",
						disabled: true,
						action: () => {}
					},
					{
						label: "📂 Criar Pasta",
						disabled: true,
						action: () => {}
					},
					{ separator: true },
					{
						label: "⏹️ Desligar Sistema",
						action: () => window.location.reload()
					}
				]
			});
		});
	}
	/**
	* Inicializa ouvintes de mouse globais para processar arraste e redimensionamento
	* independentemente da hierarquia DOM da janela.
	*/
	setupGlobalMouseListeners() {
		document.addEventListener("mousemove", (event) => {
			if (this.draggingState.pid !== null) {
				if (!this.ghostElement) this.createGhost(this.draggingState.pid);
				if (this.ghostElement) {
					this.ghostElement.style.left = `${event.clientX - this.draggingState.offsetX}px`;
					this.ghostElement.style.top = `${event.clientY - this.draggingState.offsetY}px`;
				}
			}
			if (this.resizingState.pid !== null) {
				if (!this.ghostElement) this.createGhost(this.resizingState.pid);
				if (this.ghostElement) {
					const deltaX = event.clientX - this.resizingState.startMouseX;
					const deltaY = event.clientY - this.resizingState.startMouseY;
					this.ghostElement.style.width = `${this.resizingState.startWidth + deltaX}px`;
					this.ghostElement.style.height = `${this.resizingState.startHeight + deltaY}px`;
				}
			}
		});
		document.addEventListener("mouseup", () => {
			if (this.ghostElement) {
				if (this.draggingState.pid !== null) bridge.emit(IPC_EVENTS.APP_REQUEST_MOVE, {
					pid: this.draggingState.pid,
					x: parseInt(this.ghostElement.style.left),
					y: parseInt(this.ghostElement.style.top)
				});
				if (this.resizingState.pid !== null) bridge.emit(IPC_EVENTS.APP_REQUEST_RESIZE, {
					pid: this.resizingState.pid,
					width: parseInt(this.ghostElement.style.width),
					height: parseInt(this.ghostElement.style.height)
				});
				this.ghostElement.remove();
				this.ghostElement = null;
			}
			this.draggingState.pid = null;
			this.resizingState.pid = null;
			document.body.style.cursor = "default";
		});
	}
	/**
	* Cria um frame visual temporário (Ghost) para otimizar a performance de arraste/resize.
	* Evita re-renderização custosa dos componentes internos das janelas durante a animação.
	* @param pid - PID da janela que originou a ação.
	*/
	createGhost(pid) {
		const realWin = this.renderedWindows.get(pid);
		if (!realWin) return;
		const rect = realWin.getBoundingClientRect();
		const width = this.draggingState.pid === pid && this.draggingState.ghostWidth ? this.draggingState.ghostWidth : rect.width;
		const height = this.draggingState.pid === pid && this.draggingState.ghostHeight ? this.draggingState.ghostHeight : rect.height;
		this.ghostElement = document.createElement("div");
		this.ghostElement.style.position = "absolute";
		this.ghostElement.style.left = `${rect.left}px`;
		this.ghostElement.style.top = `${rect.top}px`;
		this.ghostElement.style.width = `${width}px`;
		this.ghostElement.style.height = `${height}px`;
		this.ghostElement.style.border = "2px solid rgba(255, 255, 255, 0.8)";
		this.ghostElement.style.boxSizing = "border-box";
		this.ghostElement.style.zIndex = "9999";
		this.ghostElement.style.pointerEvents = "none";
		this.ghostElement.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
		this.container.appendChild(this.ghostElement);
	}
	/**
	* Assina o barramento sistêmico para reagir a mutações de estado enviadas pelo Kernel.
	*/
	subscribeToState() {
		bridge.on(IPC_EVENTS.STATE_UPDATED, (snapshot) => {
			this.render(snapshot);
			this.renderTaskbar(snapshot);
		});
	}
	/**
	* Renderiza a barra de tarefas (Dock) baseando-se no snapshot atual.
	* @param snapshot - Estado atual do sistema.
	*/
	renderTaskbar(snapshot) {
		const dock = document.querySelector(".dock-toolbar");
		if (!dock) return;
		dock.innerHTML = "";
		const activeAppIds = /* @__PURE__ */ new Set();
		snapshot.windows.forEach((w) => activeAppIds.add(w.appId));
		this.fixedApps.forEach((app) => {
			const btn = document.createElement("div");
			btn.className = "dock-item" + (activeAppIds.has(app.appId) ? " active" : "");
			btn.textContent = app.icon;
			btn.title = app.title;
			btn.addEventListener("click", () => {
				soundManager.playClick();
				bridge.emit(IPC_EVENTS.APP_REQUEST_TOGGLE, app.appId);
			});
			dock.appendChild(btn);
		});
		const dynamicApps = /* @__PURE__ */ new Set();
		snapshot.windows.forEach((w) => {
			if (!this.fixedApps.find((f) => f.appId === w.appId)) dynamicApps.add(w.appId);
		});
		dynamicApps.forEach((appId) => {
			const btn = document.createElement("div");
			btn.className = "dock-item active";
			btn.textContent = "⚙️";
			btn.title = appId.charAt(0).toUpperCase() + appId.slice(1);
			btn.addEventListener("click", () => {
				bridge.emit(IPC_EVENTS.APP_REQUEST_TOGGLE, appId);
			});
			dock.appendChild(btn);
		});
	}
	/**
	* Procedimento principal de renderização.
	* Realiza a sincronização diferencial (Diffing) entre o DOM atual e o snapshot recebido.
	* @param snapshot - Estado atual dos processos gráficos.
	*/
	render(snapshot) {
		const activePids = new Set(snapshot.windows.map((w) => w.pid));
		for (const [pid, element] of this.renderedWindows.entries()) if (!activePids.has(pid)) {
			element.remove();
			this.renderedWindows.delete(pid);
			this.windowSnapshots.delete(pid);
		}
		snapshot.windows.forEach((win) => {
			this.windowSnapshots.set(win.pid, win);
			if (this.renderedWindows.has(win.pid)) this.updateWindowElement(this.renderedWindows.get(win.pid), win);
			else {
				const winElement = this.createWindowElement(win);
				this.container.appendChild(winElement);
				this.renderedWindows.set(win.pid, winElement);
			}
		});
	}
	/**
	* Atualiza as propriedades visuais de um frame de janela existente.
	* Aplica regras de visibilidade e posicionamento (Normal, Maximizado, Minimizado).
	* @param el - Elemento DOM da janela.
	* @param win - Metadados de estado do processo.
	*/
	updateWindowElement(el, win) {
		if (win.isMinimized) {
			el.style.display = "none";
			return;
		} else el.style.display = "flex";
		if (win.isMaximized) {
			el.style.left = "0px";
			el.style.top = "0px";
			el.style.width = "100%";
			el.style.height = "100%";
		} else {
			el.style.left = `${win.bounds.x}px`;
			el.style.top = `${win.bounds.y}px`;
			el.style.width = `${win.bounds.width}px`;
			el.style.height = `${win.bounds.height}px`;
		}
		el.style.zIndex = win.zIndex.toString();
		el.style.border = "2px solid #fff";
		el.style.borderRightColor = "#808080";
		el.style.borderBottomColor = "#808080";
		const titleBar = el.querySelector(".title-bar");
		if (titleBar) titleBar.style.backgroundColor = win.isFocused ? "#000080" : "#808080";
		const maxBtn = el.querySelector(".max-btn");
		if (maxBtn) {
			maxBtn.textContent = win.isMaximized ? "❐" : "□";
			maxBtn.dataset.isMaximized = win.isMaximized ? "true" : "false";
		}
	}
	/**
	* Cria o esqueleto DOM de uma nova janela.
	* Inclui Barra de Título, Controles (Min/Max/Close) e Content Wrapper.
	* Realiza a injeção da OsApi no Web Component correspondente ao aplicativo.
	* @param win - Snapshot inicial do processo.
	* @returns Elemento HTML da janela montada.
	*/
	createWindowElement(win) {
		const el = document.createElement("div");
		el.className = "window-frame";
		el.style.position = "absolute";
		el.style.backgroundColor = "#c0c0c0";
		el.style.color = "#000";
		el.style.display = "flex";
		el.style.flexDirection = "column";
		this.updateWindowElement(el, win);
		const titleBar = document.createElement("div");
		titleBar.className = "title-bar";
		titleBar.style.padding = "2px 4px";
		titleBar.style.cursor = "pointer";
		titleBar.style.userSelect = "none";
		titleBar.style.color = "#fff";
		titleBar.style.display = "flex";
		titleBar.style.justifyContent = "space-between";
		titleBar.style.alignItems = "center";
		titleBar.style.margin = "2px";
		const titleText = document.createElement("span");
		titleText.textContent = win.title;
		const controlsContainer = document.createElement("div");
		controlsContainer.style.display = "flex";
		controlsContainer.style.gap = "5px";
		const createBtn = (text, onClick) => {
			const btn = document.createElement("button");
			btn.textContent = text;
			btn.style.width = "18px";
			btn.style.height = "14px";
			btn.style.fontSize = "10px";
			btn.style.cursor = "pointer";
			btn.style.backgroundColor = "#c0c0c0";
			btn.style.border = "2px solid #fff";
			btn.style.borderRightColor = "#808080";
			btn.style.borderBottomColor = "#808080";
			btn.addEventListener("click", onClick);
			return btn;
		};
		const minBtn = createBtn("—", (e) => {
			e.stopPropagation();
			soundManager.playMinimize();
			bridge.emit(IPC_EVENTS.APP_REQUEST_MINIMIZE, win.pid);
		});
		const maxBtn = createBtn("□", (e) => {
			e.stopPropagation();
			if (maxBtn.dataset.isMaximized === "true") {
				soundManager.playRestore();
				bridge.emit(IPC_EVENTS.APP_REQUEST_RESTORE, win.pid);
			} else {
				soundManager.playMaximize();
				bridge.emit(IPC_EVENTS.APP_REQUEST_MAXIMIZE, win.pid);
			}
		});
		maxBtn.className = "max-btn";
		maxBtn.dataset.isMaximized = win.isMaximized ? "true" : "false";
		const closeBtn = createBtn("✕", (e) => {
			e.stopPropagation();
			soundManager.playClose();
			bridge.emit(IPC_EVENTS.APP_REQUEST_CLOSE, win.pid);
		});
		controlsContainer.appendChild(minBtn);
		controlsContainer.appendChild(maxBtn);
		controlsContainer.appendChild(closeBtn);
		titleBar.addEventListener("mousedown", (event) => {
			const latestWin = this.windowSnapshots.get(win.pid) || win;
			bridge.emit(IPC_EVENTS.APP_REQUEST_FOCUS, latestWin.pid);
			const rect = el.getBoundingClientRect();
			let offsetX = event.clientX - rect.left;
			let offsetY = event.clientY - rect.top;
			if (latestWin.isMaximized && latestWin.previousBounds) {
				const percentX = event.clientX / rect.width;
				offsetX = latestWin.previousBounds.width * percentX;
			}
			this.draggingState = {
				pid: latestWin.pid,
				offsetX,
				offsetY,
				ghostWidth: latestWin.isMaximized && latestWin.previousBounds ? latestWin.previousBounds.width : void 0,
				ghostHeight: latestWin.isMaximized && latestWin.previousBounds ? latestWin.previousBounds.height : void 0
			};
		});
		titleBar.appendChild(titleText);
		titleBar.appendChild(controlsContainer);
		const bodyContent = document.createElement("div");
		bodyContent.className = "window-body";
		bodyContent.style.flex = "1";
		bodyContent.style.position = "relative";
		bodyContent.style.backgroundColor = "#fff";
		bodyContent.style.border = "2px solid #808080";
		bodyContent.style.borderRightColor = "#dfdfdf";
		bodyContent.style.borderBottomColor = "#dfdfdf";
		bodyContent.style.margin = "2px";
		bodyContent.style.overflow = "hidden";
		bodyContent.style.display = "flex";
		bodyContent.style.flexDirection = "column";
		const tagName = APP_REGISTRY[win.appId];
		if (tagName) {
			const appInstance = document.createElement(tagName);
			if (appInstance.attachApi) {
				const osApi = createOsApiForProcess(win.pid);
				appInstance.attachApi(osApi);
			}
			if (win.path) appInstance.setAttribute("path", win.path);
			bodyContent.appendChild(appInstance);
		} else {
			bodyContent.style.padding = "10px";
			bodyContent.textContent = "Aplicativo não instalado ou sem UI definida.";
		}
		const resizeHandle = document.createElement("div");
		resizeHandle.style.position = "absolute";
		resizeHandle.style.right = "0";
		resizeHandle.style.bottom = "0";
		resizeHandle.style.width = "15px";
		resizeHandle.style.height = "15px";
		resizeHandle.style.cursor = "nwse-resize";
		resizeHandle.addEventListener("mousedown", (event) => {
			event.stopPropagation();
			const latestWin = this.windowSnapshots.get(win.pid) || win;
			bridge.emit(IPC_EVENTS.APP_REQUEST_FOCUS, latestWin.pid);
			const rect = el.getBoundingClientRect();
			this.resizingState = {
				pid: latestWin.pid,
				startWidth: rect.width,
				startHeight: rect.height,
				startMouseX: event.clientX,
				startMouseY: event.clientY
			};
			document.body.style.cursor = "nwse-resize";
		});
		el.appendChild(titleBar);
		el.appendChild(bodyContent);
		el.appendChild(resizeHandle);
		return el;
	}
};
var DesktopCompositor = class {
	/** Referência ao elemento DOM que hospeda o grid de ícones. */
	container;
	constructor(containerId) {
		const el = document.getElementById(containerId);
		if (!el) throw new Error(`Container Desktop #${containerId} não encontrado no DOM.`);
		/**
		* Sub-container para o grid de ícones.
		* Separado do wallpaper para evitar interferências de empilhamento visual.
		*/
		this.container = document.createElement("div");
		this.container.className = "desktop-grid";
		el.appendChild(this.container);
		this.subscribeToState();
	}
	/**
	* Assina o barramento de sistema para sincronizar os itens do desktop com o Kernel.
	*/
	subscribeToState() {
		bridge.on(IPC_EVENTS.STATE_UPDATED, (snapshot) => {
			this.renderDesktop(snapshot.desktopItems || []);
		});
	}
	/**
	* Renderiza os ícones do desktop baseando-se na lista de Inodes fornecida.
	* @param items - Lista de arquivos/diretórios presentes no caminho /desktop.
	*/
	renderDesktop(items) {
		this.container.innerHTML = "";
		items.forEach((item) => {
			const iconWrap = document.createElement("div");
			iconWrap.className = "desktop-icon";
			const iconSpan = document.createElement("span");
			iconSpan.className = "icon";
			iconSpan.textContent = item.type === "directory" ? "📁" : "📝";
			const titleSpan = document.createElement("span");
			titleSpan.className = "title";
			titleSpan.textContent = item.name;
			iconWrap.appendChild(iconSpan);
			iconWrap.appendChild(titleSpan);
			/**
			* Handler de Duplo Clique (UC-003):
			* Aciona a abertura do aplicativo correspondente ao tipo de Inode.
			*/
			iconWrap.addEventListener("dblclick", () => {
				const appId = item.type === "directory" ? "explorer" : "reader";
				bridge.emit(IPC_EVENTS.APP_REQUEST_OPEN, {
					appId,
					title: item.name,
					path: item.path
				});
			});
			/**
			* Handler de Menu de Contexto:
			* Exibe opções de operação (Abrir, Nova Janela) específicas para o item.
			*/
			iconWrap.addEventListener("contextmenu", (event) => {
				event.preventDefault();
				event.stopPropagation();
				ContextMenu.getInstance().show({
					x: event.clientX,
					y: event.clientY,
					items: [
						{
							label: "📂 Abrir",
							action: () => {
								const appId = item.type === "directory" ? "explorer" : "reader";
								bridge.emit(IPC_EVENTS.APP_REQUEST_OPEN, {
									appId,
									title: item.name,
									path: item.path
								});
							}
						},
						{
							label: "🪟 Abrir em nova janela",
							action: () => {
								window.open(`${window.location.origin}${window.location.pathname}#${item.path}`, "_blank");
							}
						},
						{ separator: true },
						{
							label: "🗑️ Excluir",
							disabled: true,
							action: () => {}
						}
					]
				});
			});
			this.container.appendChild(iconWrap);
		});
	}
};
document.addEventListener("DOMContentLoaded", () => {
	new WindowCompositor("desktop-container");
	new DesktopCompositor("desktop-container");
	const hashPath = window.location.hash.substring(1);
	if (hashPath) setTimeout(() => {
		bridge.emit(IPC_EVENTS.APP_REQUEST_OPEN, { path: hashPath });
	}, 500);
});
