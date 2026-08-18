/**
 * Markdown → HTML renderer (V2, ported from v12 mdToHtml).
 *
 * Safe: escapes HTML first, then converts the common subset (**bold*,
 * *italic*, `code`, #/## headers, bullet/numbered lists, blank-line
 * paragraphs, [text](url) links, ```code blocks```). Returns an HTML string
 * for use via dangerouslySetInnerHTML (the input is escaped before any
 * markup is inserted, so injected HTML can't survive).
 *
 * Also exports toolSummary() — a compact human-readable one-liner for a
 * Genesis/KB tool call, used by the Builder status hint.
 */

export function mdToHtml(md: unknown): string {
  let s = String(md == null ? "" : md);
  // escape HTML first
  s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  // fenced code blocks ```...```
  s = s.replace(/```([\s\S]*?)```/g, (_, code) => `<pre class="md-pre"><code>${code.replace(/^\n/, "")}</code></pre>`);
  // inline code `...`
  s = s.replace(/`([^`\n]+)`/g, '<code class="md-code">$1</code>');
  // links [text](url) — only https? links
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  // plain urls on their own line → linkify
  s = s.replace(/(^|\n)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  // headers ### / ## / #
  s = s.replace(/^###\s+(.*)$/gm, '<div class="md-h3">$1</div>');
  s = s.replace(/^##\s+(.*)$/gm, '<div class="md-h2">$1</div>');
  s = s.replace(/^#\s+(.*)$/gm, '<div class="md-h1">$1</div>');
  // bold + italic (bold first so ** isn't eaten by *)
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_\n]+?)__/g, "<strong>$1</strong>");
  s = s.replace(/(?<![\*\w])\*([^*\n]+?)\*(?![\*\w])/g, "<em>$1</em>");
  s = s.replace(/(?<![\w_])_([^_\n]+?)_(?![\w_])/g, "<em>$1</em>");
  // bullet lists (- or *) — collapse consecutive lines into <ul>
  s = s.replace(/(?:^|\n)((?:\s*[-*]\s+.*(?:\n|$))+)/g, (block) => {
    const items = block.trim().split(/\n/).map((line) => line.replace(/^\s*[-*]\s+/, "").trim()).filter(Boolean);
    return `\n<ul class="md-ul">${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
  });
  // numbered lists
  s = s.replace(/(?:^|\n)((?:\s*\d+\.\s+.*(?:\n|$))+)/g, (block) => {
    const items = block.trim().split(/\n/).map((line) => line.replace(/^\s*\d+\.\s+/, "").trim()).filter(Boolean);
    return `\n<ol class="md-ol">${items.map((i) => `<li>${i}</li>`).join("")}</ol>`;
  });
  // blank line → paragraph break; single newlines → <br>
  s = s.replace(/\n{2,}/g, "</p><p>");
  s = s.replace(/\n/g, "<br>");
  // wrap bare text in <p> (skip block-level elements already inserted)
  s = s.split("</p><p>").map((seg) => {
    if (/^<(h\d|ul|ol|pre|div)/.test(seg.trim()) || seg.trim() === "") return seg;
    return `<p>${seg}</p>`;
  }).join("</p><p>");
  // tidy: remove empty <p></p>
  s = s.replace(/<p>\s*<\/p>/g, "");
  return s;
}

/** Compact one-liner for a tool call, ported from v12 toolSummary(). */
export function toolSummary(name: string, args: Record<string, unknown>): string {
  const a = args || {};
  const argList = (xs: unknown): string => {
    if (Array.isArray(xs)) return xs.join(", ");
    if (typeof xs === "string") return xs;
    return "";
  };
  const s = (v: unknown, n = 70): string => String(v ?? "").slice(0, n);
  switch (name) {
    case "genesis_context": return "📖 Read project context";
    case "genesis_read_file": return `📖 Read ${argList(a.path)}`;
    case "genesis_read_files": return `📖 Read ${argList(a.paths)}`;
    case "genesis_search": return `🔍 Search project for "${s(a.query)}"`;
    case "genesis_write_file": return `✏️ Write ${s(a.path)}`;
    case "genesis_edit_file": return `✏️ Edit ${s(a.path)}`;
    case "genesis_apply_patch": return `✏️ Apply patch to ${s(a.path, 30) || "project"}`;
    case "genesis_delete_file": return `🗑️ Delete ${s(a.path)}`;
    case "genesis_reconcile_pages": return "🔄 Reconcile pages";
    case "genesis_selection": return "👀 Read current selection";
    case "genesis_list_projects": return "📖 List projects";
    case "genesis_read_project": return "📖 Read another project";
    case "genesis_preview": return "🖥️ Warm preview";
    case "genesis_preview_logs": return "🔍 Check preview logs (did it compile?)";
    case "genesis_screenshot": return "📸 Screenshot live preview";
    case "genesis_publish": return "🚀 Publish to live CDN";
    case "genesis_cloud_status": return "🗄️ Cloud status";
    case "genesis_cloud_schema": return "🗄️ Read DB schema";
    case "genesis_cloud_sql": return `🗄️ Run SQL${a.allowWrite ? " (write)" : " (read)"}: ${s(a.sql, 60)}`;
    case "genesis_cloud_migrate": return "🗄️ Run DB migration";
    case "genesis_cloud_functions": return "🗄️ List edge functions";
    case "genesis_cloud_function_deploy": return `🗄️ Deploy edge function ${s(a.name)}`;
    case "genesis_cloud_function_logs": return `🗄️ Edge function logs: ${s(a.name)}`;
    case "genesis_cloud_secrets_list": return "🗄️ List secrets";
    case "genesis_cloud_secret_set": return `🗄️ Set secret ${s(a.key)}`;
    case "genesis_cloud_secret_delete": return `🗄️ Delete secret ${s(a.key)}`;
    case "genesis_cloud_realtime": return "🗄️ Cloud realtime";
    case "genesis_generate_image": return `🎨 Generate image: ${s(a.prompt, 50)}`;
    case "genesis_generate_video": return `🎬 Generate video: ${s(a.prompt, 50)}`;
    case "genesis_edit_video": return "🎬 Edit video";
    case "genesis_elements": return "🧩 List elements";
    case "genesis_provision_element": return `🧩 Provision element: ${s(a.type)}`;
    case "genesis_crm_status": return "👤 CRM status";
    case "genesis_crm_provision_auth": return "👤 Provision member auth";
    case "genesis_global_vars": return "⚙️ List global variables";
    case "genesis_global_var_set": return `⚙️ Set global variable ${s(a.key)}`;
    case "genesis_global_var_delete": return `⚙️ Delete global variable ${s(a.key)}`;
    case "genesis_data_files": return "📂 List data files";
    case "genesis_data_file_read": return `📂 Read data file ${s(a.path)}`;
    case "genesis_data_file_write": return `📂 Write data file ${s(a.path)}`;
    case "genesis_connectors": return "🔌 List connectors";
    case "genesis_connector_save": return `🔌 Save connector ${s(a.type)}`;
    case "genesis_connector_admin": return `🔌 Connector admin: ${s(a.type)}`;
    case "genesis_connector_delete": return `🔌 Delete connector ${s(a.type)}`;
    case "genesis_supabase_auth_sync": return "🔌 Sync Supabase auth";
    case "genesis_contracts_list": return "📜 List site AI contracts";
    case "genesis_contract_save": return "📜 Save site AI contract";
    case "genesis_contract_delete": return "📜 Delete site AI contract";
    case "genesis_blog_write_post": return `✍️ Write blog post: ${s(a.title, 50)}`;
    case "genesis_tracking_set": return `📊 Set tracking: ${s(a.type)}`;
    case "genesis_localize": return "🌐 Localize site";
    case "genesis_pages": return "📄 List pages";
    case "genesis_page_folder_create": return `📄 Create page folder ${s(a.name)}`;
    case "genesis_page_move": return "📄 Move page";
    case "genesis_subdomains": return "🌐 List subdomains";
    case "genesis_subdomain_connect": return `🌐 Connect subdomain ${s(a.subdomain)}`;
    case "genesis_ssr_status": return "🌐 SSR status";
    case "genesis_ssr_publish": return "🌐 Publish SSR";
    case "genesis_ssr_install_package": return "🌐 Install SSR package";
    case "genesis_ssr_scale": return "🌐 Scale SSR";
    case "genesis_ssr_restart": return "🌐 Restart SSR";
    case "genesis_ask_user": return `❓ Ask user: ${s(a.question, 60)}`;
    case "estage_kb_query": return `📚 KB: ${s(a.question)}`;
    default: return name;
  }
}
