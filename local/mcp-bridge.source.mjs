import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as z from "zod/v4";

function text(value) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function createServer(bridge) {
  const server = new McpServer({ name: "PentaMark Vault", version: "2.4.0" }, {
    instructions: "Este servidor é a Ponte IA do PentaMark. Ele dá acesso sob demanda ao cofre Markdown compartilhado. Antes de editar, leia o arquivo e envie expected_revision em write_file para detectar conflitos. Prefira search_files/list_files para localizar conteúdo. Alterações são sincronizadas imediatamente com os usuários do PentaMark.",
  });

  server.registerTool("list_files", {
    title: "Listar arquivos do cofre",
    description: "Lista notas, imagens, áudios e outros arquivos do cofre. Aceita filtro textual opcional no caminho.",
    inputSchema: { filter: z.string().optional(), limit: z.number().int().min(1).max(5000).optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ filter = "", limit = 1000 }) => text(await bridge.listFiles(filter, limit)));

  server.registerTool("read_file", {
    title: "Ler arquivo de texto",
    description: "Lê uma nota Markdown ou outro arquivo textual. Retorna conteúdo, caminho e revisão para edição segura.",
    inputSchema: {
      path: z.string().min(1),
      start_line: z.number().int().min(1).optional(),
      end_line: z.number().int().min(1).optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ path, start_line, end_line }) => text(await bridge.readFile(path, start_line, end_line)));

  server.registerTool("open_asset", {
    title: "Abrir asset",
    description: "Retorna um link direto para imagem, áudio, vídeo, PDF ou outro asset do cofre.",
    inputSchema: { path: z.string().min(1) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ path }) => {
    const asset = await bridge.openAsset(path);
    return {
      content: [
        { type: "text", text: `Asset do PentaMark: ${asset.path}` },
        { type: "resource_link", uri: asset.url, name: asset.name, mimeType: asset.mimeType, description: "Arquivo servido pelo host do PentaMark" },
      ],
    };
  });

  server.registerTool("search_files", {
    title: "Buscar no cofre",
    description: "Busca texto nas notas e arquivos textuais e devolve caminhos, linhas e trechos.",
    inputSchema: { query: z.string().min(1), path_prefix: z.string().optional(), limit: z.number().int().min(1).max(500).optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ query, path_prefix = "", limit = 100 }) => text(await bridge.searchFiles(query, path_prefix, limit)));

  server.registerTool("write_file", {
    title: "Criar ou editar arquivo",
    description: "Grava conteúdo textual no cofre. Use expected_revision retornada por read_file para evitar sobrescrever edições concorrentes.",
    inputSchema: { path: z.string().min(1), content: z.string(), expected_revision: z.string().optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ path, content, expected_revision }) => text(await bridge.writeFile(path, content, expected_revision)));

  server.registerTool("move_file", {
    title: "Mover ou renomear arquivo",
    description: "Move ou renomeia um arquivo dentro do cofre.",
    inputSchema: { path: z.string().min(1), new_path: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ path, new_path }) => text(await bridge.moveFile(path, new_path)));

  server.registerTool("delete_file", {
    title: "Mover arquivo para a lixeira",
    description: "Move um arquivo para .trash. A operação é recuperável pelo host.",
    inputSchema: { path: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ path }) => text(await bridge.deleteFile(path)));

  return server;
}

export async function handleMcpRequest(req, res, body, bridge) {
  const server = createServer(bridge);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } finally {
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
  }
}
