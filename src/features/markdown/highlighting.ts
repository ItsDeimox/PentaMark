import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import glsl from "highlight.js/lib/languages/glsl";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import lua from "highlight.js/lib/languages/lua";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("c", c);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("css", css);
hljs.registerLanguage("glsl", glsl);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("lua", lua);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("python", python);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);

export const CODE_LANGUAGES: Record<string, { grammar: string; label: string }> = {
  bash: { grammar: "bash", label: "BASH" }, sh: { grammar: "bash", label: "SHELL" }, shell: { grammar: "bash", label: "SHELL" },
  c: { grammar: "c", label: "C" }, h: { grammar: "c", label: "C" },
  cpp: { grammar: "cpp", label: "C++" }, "c++": { grammar: "cpp", label: "C++" }, cc: { grammar: "cpp", label: "C++" },
  cs: { grammar: "csharp", label: "C#" }, csharp: { grammar: "csharp", label: "C#" }, dotnet: { grammar: "csharp", label: "C#" },
  css: { grammar: "css", label: "CSS" }, scss: { grammar: "css", label: "SCSS" },
  glsl: { grammar: "glsl", label: "GLSL" }, shader: { grammar: "glsl", label: "GODOT SHADER" }, godotshader: { grammar: "glsl", label: "GODOT SHADER" },
  js: { grammar: "javascript", label: "JAVASCRIPT" }, jsx: { grammar: "javascript", label: "JSX" }, javascript: { grammar: "javascript", label: "JAVASCRIPT" }, mjs: { grammar: "javascript", label: "JAVASCRIPT" },
  json: { grammar: "json", label: "JSON" }, jsonc: { grammar: "json", label: "JSON" },
  lua: { grammar: "lua", label: "LUA" }, luau: { grammar: "lua", label: "LUAU" },
  md: { grammar: "markdown", label: "MARKDOWN" }, markdown: { grammar: "markdown", label: "MARKDOWN" },
  py: { grammar: "python", label: "PYTHON" }, python: { grammar: "python", label: "PYTHON" }, gd: { grammar: "python", label: "GDSCRIPT" }, gdscript: { grammar: "python", label: "GDSCRIPT" },
  sql: { grammar: "sql", label: "SQL" },
  ts: { grammar: "typescript", label: "TYPESCRIPT" }, tsx: { grammar: "typescript", label: "TSX" }, typescript: { grammar: "typescript", label: "TYPESCRIPT" },
  html: { grammar: "xml", label: "HTML" }, htm: { grammar: "xml", label: "HTML" }, xml: { grammar: "xml", label: "XML" }, svg: { grammar: "xml", label: "SVG" },
  yaml: { grammar: "yaml", label: "YAML" }, yml: { grammar: "yaml", label: "YAML" },
};

export default hljs;
