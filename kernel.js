(function() {
	var EventBus = class {
		/** Mapa de ouvintes registrados, indexados pelo nome do evento. */
		listeners = /* @__PURE__ */ new Map();
		/**
		* Registra um callback para ser executado quando um evento específico for emitido.
		* @param event - Identificador do evento.
		* @param handler - Função de tratamento que receberá o payload.
		*/
		on(event, handler) {
			if (!this.listeners.has(event)) this.listeners.set(event, []);
			this.listeners.get(event).push(handler);
		}
		/**
		* Despacha uma mensagem e seu payload opcional para todos os ouvintes inscritos.
		* @param event - Identificador do evento.
		* @param payload - Dados associados ao evento.
		*/
		emit(event, payload) {
			const handlers = this.listeners.get(event);
			if (handlers) handlers.forEach((handler) => handler(payload));
		}
	};
	/** Instância singleton do barramento de sistema para tráfego interno do Kernel. */
	const systemBus = new EventBus();
	var VirtualFileSystem = class {
		/**
		* Matriz de endereçamento do sistema de arquivos.
		* A chave é o caminho absoluto (path) para acesso imediato.
		*/
		memoryMap = /* @__PURE__ */ new Map();
		constructor() {
			this.mountRoot();
		}
		/**
		* Inicializa o nó raiz inquebrável do sistema.
		* Garante a estabilidade do bootstrapping em caso de ausência de sementes externas.
		*/
		mountRoot() {
			this.memoryMap.set("/", {
				id: "root-0000",
				path: "/",
				name: "root",
				type: "directory",
				createdAt: Date.now(),
				updatedAt: Date.now()
			});
		}
		/**
		* Inicia o carregamento e montagem da semente de configuração (ROM).
		* @param manifestUrl - URL do arquivo JSON contendo o manifesto do disco.
		* @returns Promise que resolve após a conclusão do mounting recursivo.
		*/
		async bootSeed(manifestUrl) {
			try {
				const response = await fetch(manifestUrl);
				if (response.ok) {
					const seedRoot = await response.json();
					const baseUrl = manifestUrl.substring(0, manifestUrl.lastIndexOf("/"));
					this.mount(seedRoot, "", baseUrl);
				}
			} catch (error) {
				console.warn(`[VFS] Falha no bootstrapping a partir de ${manifestUrl}.`, error);
			}
		}
		/**
		* Algoritmo de Montagem Recursiva.
		* Converte nós de semente (ISeedNode) em Inodes de runtime (INode).
		* @param seed - Nó da semente a ser processado.
		* @param parentPath - Caminho acumulado do diretório pai.
		* @param baseUrl - Base URL para resolução de assets físicos.
		*/
		mount(seed, parentPath, baseUrl) {
			const isRoot = seed.name === "root" || seed.name === "/";
			const fullPath = isRoot ? "/" : `${parentPath}/${seed.name}`.replace("//", "/");
			const node = {
				id: `seed-${Math.random().toString(36).substring(7)}`,
				path: fullPath,
				name: isRoot ? "root" : seed.name,
				type: seed.type,
				createdAt: Date.now(),
				updatedAt: Date.now()
			};
			if (seed.type === "file") node.assetUrl = `${baseUrl}${fullPath}`;
			this.memoryMap.set(fullPath, node);
			if (seed.children && Array.isArray(seed.children)) seed.children.forEach((child) => this.mount(child, fullPath, baseUrl));
		}
		/**
		* Recupera todos os itens contidos diretamente em um diretório.
		* @param parentPath - Caminho do diretório pai.
		* @returns Array de INodes dos filhos diretos.
		* @complexity O(N) - Onde N é o número total de arquivos no sistema.
		* Nota: Pode ser otimizado futuramente com um índice de árvores para O(K) onde K é o número de filhos.
		*/
		getChildren(parentPath) {
			const items = [];
			const normalizedParent = parentPath.endsWith("/") ? parentPath : `${parentPath}/`;
			this.memoryMap.forEach((node, path) => {
				if (path === parentPath) return;
				if (path.startsWith(normalizedParent)) {
					if (!path.substring(normalizedParent.length).includes("/")) items.push(node);
				}
			});
			return items;
		}
		/**
		* Busca um Inode específico via caminho absoluto.
		* @param path - Caminho completo do recurso.
		* @returns O Inode correspondente ou undefined.
		* @complexity O(1) - Acesso direto via Hash Map.
		*/
		getNode(path) {
			return this.memoryMap.get(path);
		}
		/**
		* Realiza a leitura do conteúdo de um arquivo.
		* Implementa estratégia de cache transparente: busca na ROM caso os dados não estejam em RAM.
		* @param path - Caminho absoluto do arquivo.
		* @returns Conteúdo em texto ou null em caso de falha.
		*/
		async readFile(path) {
			const node = this.getNode(path);
			if (!node || node.type !== "file") return null;
			if (node.content && typeof node.content === "string") return node.content;
			if (node.assetUrl) try {
				const response = await fetch(node.assetUrl);
				if (response.ok) {
					const content = await response.text();
					node.content = content;
					return content;
				}
			} catch (error) {
				console.error(`[VFS] Erro de I/O ao ler asset do arquivo ${path}:`, error);
			}
			return null;
		}
		/**
		* Atualiza ou cria um nó na memória RAM.
		* @param node - Nó a ser persistido.
		*/
		setNode(node) {
			this.memoryMap.set(node.path, node);
			this.syncToDisk(node);
		}
		/**
		* Realiza a sincronização do estado da RAM com o armazenamento físico persistente (IndexedDB).
		* Operação não-bloqueante executada no contexto do Kernel Worker.
		* @param node - Nó a ser sincronizado.
		*/
		syncToDisk(_node) {}
	};
	/** Instância única do sistema de arquivos disponível no escopo do Kernel. */
	const vfs = new VirtualFileSystem();
	const IPC_EVENTS = {
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
	const SYSTEM_PATHS = {
		/** Ponto de montagem virtual onde o Compositor busca os ícones e atalhos da área de trabalho. */
		DESKTOP: "/desktop",
		/** Localização do manifesto de descoberta de arquivos para inicialização do VFS (ROM). */
		SEED_MANIFEST: "/disk-001/manifest.json"
	};
	var ProcessManager = class {
		/** Mapa de janelas ativas indexadas por PID. */
		activeWindows = /* @__PURE__ */ new Map();
		/** Contador sequencial para atribuição de Process IDs (PID). */
		nextPid = 1;
		/** Contador global de profundidade visual para gestão de sobreposição. */
		currentZIndex = 100;
		/** Contador de deslocamento para implementação do efeito de cascata em novas janelas. */
		cascadeOffsetCounter = 0;
		constructor() {
			this.listenToEvents();
		}
		/**
		* Assina os eventos do barramento de sistema relacionados à gestão de janelas e processos.
		*/
		listenToEvents() {
			systemBus.on(IPC_EVENTS.APP_REQUEST_OPEN, (payload) => this.spawnProcess(payload));
			systemBus.on(IPC_EVENTS.APP_REQUEST_FOCUS, (pid) => this.focusProcess(pid));
			systemBus.on(IPC_EVENTS.APP_REQUEST_TOGGLE, (appId) => this.toggleProcessGroup(appId));
			systemBus.on(IPC_EVENTS.APP_REQUEST_MOVE, (payload) => this.moveProcess(payload));
			systemBus.on(IPC_EVENTS.APP_REQUEST_RESIZE, (payload) => this.resizeProcess(payload));
			systemBus.on(IPC_EVENTS.APP_REQUEST_CLOSE, (pid) => this.closeProcess(pid));
			systemBus.on(IPC_EVENTS.APP_REQUEST_MINIMIZE, (pid) => this.minimizeProcess(pid));
			systemBus.on(IPC_EVENTS.APP_REQUEST_MAXIMIZE, (pid) => this.maximizeProcess(pid));
			systemBus.on(IPC_EVENTS.APP_REQUEST_RESTORE, (pid) => this.restoreProcess(pid));
		}
		/**
		* Instancia um novo processo e define suas propriedades iniciais de renderização.
		* Implementa lógica de cascata automática e inferência de aplicativo via Deep Link.
		* @param payload - Metadados de inicialização (appId, path, title).
		*/
		spawnProcess(payload) {
			const pid = this.nextPid++;
			let appId = payload.appId;
			let title = payload.title;
			if (!appId && payload.path) {
				const node = vfs.getNode(payload.path);
				if (node) {
					appId = node.type === "directory" ? "explorer" : "reader";
					title = node.name;
				} else {
					console.warn(`[ProcessManager] Tentativa de Deep Link inválida para caminho inexistente: ${payload.path}`);
					return;
				}
			}
			const offset = this.cascadeOffsetCounter * 25;
			this.cascadeOffsetCounter++;
			if (offset > 150) this.cascadeOffsetCounter = 0;
			const newWindow = {
				pid,
				appId: appId || "unknown",
				path: payload.path,
				title: title || `App ${pid}`,
				zIndex: ++this.currentZIndex,
				isFocused: true,
				bounds: {
					x: 100 + offset,
					y: 80 + offset,
					width: 600,
					height: 400
				}
			};
			this.activeWindows.forEach((win) => win.isFocused = false);
			this.activeWindows.set(pid, newWindow);
			this.broadcastState();
		}
		/**
		* Transfere o foco de entrada para um processo específico e o move para o topo visual.
		* @param pid - PID do processo a ser focado.
		*/
		focusProcess(pid) {
			const win = this.activeWindows.get(pid);
			if (!win || win.isFocused) return;
			this.activeWindows.forEach((w) => w.isFocused = false);
			win.isFocused = true;
			win.zIndex = ++this.currentZIndex;
			if (win.isMinimized) win.isMinimized = false;
			this.broadcastState();
		}
		/**
		* Implementa a lógica de alternância (Toggle) do Taskbar.
		* Realiza o revezamento entre instâncias de um mesmo aplicativo ou minimização caso já focado.
		* @param appId - Identificador do grupo de aplicativos.
		*/
		toggleProcessGroup(appId) {
			const groupWindows = Array.from(this.activeWindows.values()).filter((w) => w.appId === appId);
			if (groupWindows.length === 0) {
				this.spawnProcess({
					appId,
					title: appId.charAt(0).toUpperCase() + appId.slice(1)
				});
				return;
			}
			const topGroupWindow = groupWindows.reduce((prev, current) => prev.zIndex > current.zIndex ? prev : current);
			const osTopWindow = Array.from(this.activeWindows.values()).reduce((prev, current) => prev.zIndex > current.zIndex ? prev : current);
			if (topGroupWindow.pid === osTopWindow.pid && topGroupWindow.isFocused) this.minimizeProcess(topGroupWindow.pid);
			else this.focusProcess(topGroupWindow.pid);
		}
		/**
		* Atualiza as coordenadas posicionais de uma janela.
		* @param payload - Contém o PID e as novas coordenadas (x, y).
		*/
		moveProcess(payload) {
			const win = this.activeWindows.get(payload.pid);
			if (!win) return;
			if (win.isMaximized) this.restoreProcess(payload.pid);
			win.bounds.x = payload.x;
			win.bounds.y = payload.y;
			this.broadcastState();
		}
		/**
		* Atualiza as dimensões de uma janela, respeitando limites mínimos de engenharia.
		* @param payload - Contém o PID e as novas dimensões (width, height).
		*/
		resizeProcess(payload) {
			const win = this.activeWindows.get(payload.pid);
			if (!win) return;
			const finalWidth = Math.max(payload.width, 300);
			const finalHeight = Math.max(payload.height, 200);
			win.bounds.width = finalWidth;
			win.bounds.height = finalHeight;
			this.broadcastState();
		}
		/**
		* Finaliza um processo e realiza a limpeza de seus recursos visuais.
		* Transfere automaticamente o foco para a próxima janela na ordem de Z-index.
		* @param pid - PID do processo a ser encerrado.
		*/
		closeProcess(pid) {
			if (!this.activeWindows.has(pid)) return;
			const wasFocused = this.activeWindows.get(pid)?.isFocused;
			this.activeWindows.delete(pid);
			if (wasFocused && this.activeWindows.size > 0) {
				const topWindow = Array.from(this.activeWindows.values()).reduce((prev, current) => prev.zIndex > current.zIndex ? prev : current);
				topWindow.isFocused = true;
			}
			this.broadcastState();
		}
		/**
		* Oculta visualmente um processo, mantendo seu estado lógico preservado.
		* @param pid - PID do processo a ser minimizado.
		*/
		minimizeProcess(pid) {
			const win = this.activeWindows.get(pid);
			if (!win) return;
			win.isMinimized = true;
			win.isFocused = false;
			const activeWindows = Array.from(this.activeWindows.values()).filter((w) => w.pid !== pid && !w.isMinimized);
			if (activeWindows.length > 0) {
				const topWindow = activeWindows.reduce((prev, current) => prev.zIndex > current.zIndex ? prev : current);
				topWindow.isFocused = true;
			}
			this.broadcastState();
		}
		/**
		* Expande o processo para utilizar toda a área útil disponível na viewport.
		* Realiza cache das dimensões anteriores para futura restauração.
		* @param pid - PID do processo a ser maximizado.
		*/
		maximizeProcess(pid) {
			const win = this.activeWindows.get(pid);
			if (!win) return;
			win.previousBounds = { ...win.bounds };
			win.isMaximized = true;
			this.broadcastState();
		}
		/**
		* Retorna um processo ao seu estado original (Bounds e visibilidade) anterior
		* a uma operação de Maximização ou Minimização.
		* @param pid - PID do processo a ser restaurado.
		*/
		restoreProcess(pid) {
			const win = this.activeWindows.get(pid);
			if (!win) return;
			win.isMaximized = false;
			win.isMinimized = false;
			if (win.previousBounds) win.bounds = { ...win.previousBounds };
			this.broadcastState();
		}
		/**
		* Despacha o snapshot de estado global atualizado para todos os observadores do barramento.
		* Gatilho para a re-renderização da Main Thread.
		*/
		broadcastState() {
			const snapshot = {
				windows: Array.from(this.activeWindows.values()),
				desktopItems: vfs.getChildren(SYSTEM_PATHS.DESKTOP)
			};
			systemBus.emit(IPC_EVENTS.STATE_UPDATED, snapshot);
		}
	};
	/** Instância singleton do ProcessManager responsável pelo ecossistema de janelas do Kernel. */
	const processManager = new ProcessManager();
	var Shell = class {
		/** Mapa de diretórios de trabalho atuais indexados pelo PID do processo solicitante. */
		cwdMap = /* @__PURE__ */ new Map();
		constructor() {
			this.listen();
		}
		/**
		* Inicializa os ouvintes do barramento de sistema para requisições de execução.
		*/
		listen() {
			systemBus.on(IPC_EVENTS.SHELL_REQUEST_EXEC, async (payload) => {
				const { pid, command } = payload;
				const result = await this.execute(pid, command);
				systemBus.emit(IPC_EVENTS.SHELL_RESPONSE_EXEC, {
					pid,
					...result
				});
			});
		}
		/**
		* Recupera o diretório de trabalho atual para um processo específico.
		* @param pid - Identificador do processo.
		* @returns Caminho absoluto do CWD.
		*/
		getCWD(pid) {
			return this.cwdMap.get(pid) || "/";
		}
		/**
		* Processa e executa uma linha de comando.
		* @param pid - PID do processo chamador.
		* @param fullCommand - String bruta do comando.
		* @returns Promessa com a saída (output) e o novo estado de navegação.
		*/
		async execute(pid, fullCommand) {
			const parts = fullCommand.trim().split(/\s+/);
			const cmd = parts[0].toLowerCase();
			const args = parts.slice(1);
			const cwd = this.getCWD(pid);
			let output = "";
			switch (cmd) {
				case "help":
					output = "Comandos disponíveis: ls, cd, cat, clear, help, whoami";
					break;
				case "whoami":
					output = "guest";
					break;
				case "ls": {
					const path = args[0] ? this.resolvePath(cwd, args[0]) : cwd;
					output = vfs.getChildren(path).map((i) => i.type === "directory" ? `${i.name}/` : i.name).join("  ");
					break;
				}
				case "cd": {
					const target = args[0] || "/";
					const newPath = this.resolvePath(cwd, target);
					const node = vfs.getNode(newPath);
					if (node && node.type === "directory") this.cwdMap.set(pid, newPath);
					else output = `osh: cd: ${target}: Diretório não encontrado`;
					break;
				}
				case "cat":
					if (!args[0]) output = "uso: cat <arquivo>";
					else {
						const path = this.resolvePath(cwd, args[0]);
						const content = await vfs.readFile(path);
						output = content !== null ? content : `osh: cat: ${args[0]}: Arquivo não encontrado`;
					}
					break;
				case "clear":
					output = "__CLEAR__";
					break;
				case "": break;
				default: output = `osh: comando não encontrado: ${cmd}`;
			}
			return {
				output,
				cwd: this.getCWD(pid)
			};
		}
		/**
		* Resolve um caminho (relativo ou absoluto) baseando-se no contexto atual.
		* @param cwd - Diretório de trabalho atual.
		* @param target - Caminho alvo solicitado.
		* @returns Caminho absoluto normalizado.
		*/
		resolvePath(cwd, target) {
			if (target.startsWith("/")) return target;
			if (target === "..") {
				const parts = cwd.split("/").filter((p) => p);
				parts.pop();
				return "/" + parts.join("/");
			}
			return (cwd === "/" ? "/" + target : cwd + "/" + target).replace("//", "/");
		}
	};
	new Shell();
	/**
	* Fronteira de entrada: Web Worker <-> Main Thread.
	* Converte payloads de postMessage em eventos tipados no barramento sistêmico.
	*/
	self.addEventListener("message", (event) => {
		const { event: eventName, payload } = event.data;
		if (!eventName) return;
		systemBus.emit(eventName, payload);
	});
	/**
	* Subsistema de Arquivos: Handler de Leitura de Arquivo.
	* Processa requisições assíncronas de I/O de dados brutos.
	*/
	systemBus.on(IPC_EVENTS.FS_REQUEST_READ, async (payload) => {
		const content = await vfs.readFile(payload.path);
		systemBus.emit(IPC_EVENTS.FS_RESPONSE_READ, {
			requestId: payload.requestId,
			content
		});
	});
	/**
	* Subsistema de Arquivos: Handler de Listagem de Diretório.
	* Provê a árvore de Inodes para navegadores de arquivos e desktop.
	*/
	systemBus.on(IPC_EVENTS.FS_REQUEST_READDIR, (payload) => {
		const items = vfs.getChildren(payload.path);
		systemBus.emit(IPC_EVENTS.FS_RESPONSE_READDIR, {
			requestId: payload.requestId,
			items
		});
	});
	/**
	* Ponte de Saída: Sincronização de Estado Global.
	* Encaminha snapshots de mutação do Kernel para o Compositor visual.
	*/
	systemBus.on(IPC_EVENTS.STATE_UPDATED, (snapshot) => {
		self.postMessage({
			event: IPC_EVENTS.STATE_UPDATED,
			payload: snapshot
		});
	});
	/**
	* Camada de Forwarding: Respostas de Syscalls.
	* Realiza o roteamento de payloads de resposta para a Main Thread.
	*/
	systemBus.on(IPC_EVENTS.FS_RESPONSE_READ, (payload) => {
		self.postMessage({
			event: IPC_EVENTS.FS_RESPONSE_READ,
			payload
		});
	});
	systemBus.on(IPC_EVENTS.FS_RESPONSE_READDIR, (payload) => {
		self.postMessage({
			event: IPC_EVENTS.FS_RESPONSE_READDIR,
			payload
		});
	});
	systemBus.on(IPC_EVENTS.SHELL_RESPONSE_EXEC, (payload) => {
		self.postMessage({
			event: IPC_EVENTS.SHELL_RESPONSE_EXEC,
			payload
		});
	});
	systemBus.on(IPC_EVENTS.MAIL_RESPONSE_SEND, (payload) => {
		self.postMessage({
			event: IPC_EVENTS.MAIL_RESPONSE_SEND,
			payload
		});
	});
	/**
	* Subsistema de Mensageria: Handler de Envio de Email.
	* Simula o despacho de correio eletrônico e retorna confirmação.
	*/
	systemBus.on(IPC_EVENTS.MAIL_REQUEST_SEND, (payload) => {
		console.log("[Kernel] Despachando email para o autor:", payload);
		setTimeout(() => {
			systemBus.emit(IPC_EVENTS.MAIL_RESPONSE_SEND, {
				pid: payload.pid,
				success: true
			});
		}, 1500);
	});
	/**
	* Log de auditoria: Confirmação de integridade dos motores core.
	*/
	console.log("[Kernel] Web Worker Boot completo. Motores Headless rodando:", {
		vfs,
		processManager
	});
	/**
	* Procedimento de Bootstrapping:
	* 1. Carrega a semente ROM do sistema.
	* 2. Realiza o broadcast inicial de estado para preencher a UI do usuário.
	*/
	vfs.bootSeed(SYSTEM_PATHS.SEED_MANIFEST).then(() => {
		processManager["broadcastState"]();
	});
})();
