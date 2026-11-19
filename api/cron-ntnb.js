// Captura diária das taxas de NTN-B na ANBIMA, agendada pela Vercel.
//
// Substitui a tarefa `SalvarNtnbSemanal` que rodava no PC do Daniel: ela dependia da máquina
// estar ligada (dias perdidos quando ele viajava) e abria uma janela de console a cada boot.
//
// Como grava: uma função serverless não tem disco — nasce, executa e morre. Então o dado vai
// pro próprio repositório, via API do GitHub, em data/ntnb-historico.json (a fonte de verdade
// lida por api/ntnb.js). O commit dispara um redeploy, que é justamente o que faz o dado novo
// entrar no ar.
//
// Idempotente de propósito: a Vercel avisa que uma execução agendada pode ser disparada mais de
// uma vez, ou nenhuma. Aqui a janela de dias úteis é reprocessada inteira a cada corrida, só os
// dias AUSENTES são acrescentados, e sem novidade não há commit nenhum. Rodar duas vezes tem o
// mesmo efeito de rodar uma; pular um dia é recuperado na corrida seguinte.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const TARGETS = ['20280815', '20290515', '20300815', '20320815', '20350515', '20450515'];
const ARQUIVO = 'data/ntnb-historico.json';

// 12 dias úteis: cobre a semana e dá sobreposição entre corridas, então uma falha isolada é
// recuperada depois — sem passar da retenção da ANBIMA (~9 dias úteis no arquivo público).
const JANELA_DIAS_UTEIS = 12;

function diasUteisPraTras(inicio, n) {
  const dias = [];
  const d = new Date(inicio);
  while (dias.length < n) {
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      dias.push(`${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`);
    }
    d.setDate(d.getDate() - 1);
  }
  return dias;
}

const toDate = (br) => { const [d, m, y] = br.split('/'); return new Date(+y, +m - 1, +d); };

// Formato do arquivo da ANBIMA: campos separados por "@", NTN-B na coluna 0, vencimento na 4 e
// a taxa indicativa na 7. Mesma leitura de api/ntnb.js.
function lerTaxas(texto) {
  const rates = {};
  for (const linha of texto.split('\n')) {
    const cols = linha.split('@');
    if (cols[0]?.trim() !== 'NTN-B') continue;
    const venc = cols[4]?.trim();
    if (TARGETS.includes(venc)) {
      const taxa = parseFloat(cols[7]?.trim().replace(',', '.'));
      if (!isNaN(taxa)) rates[venc.slice(0, 4)] = taxa;
    }
  }
  return rates;
}

async function buscarDia(dt) {
  try {
    const [dia, mes, ano] = dt.split('/');
    const url = `https://www.anbima.com.br/informacoes/merc-sec/arqs/ms${ano.slice(-2)}${mes}${dia}.txt`;
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null; // feriado, fim de semana ou dia fora da retenção — não é erro
    const rates = lerTaxas(await r.text());
    return Object.keys(rates).length ? rates : null;
  } catch {
    return null;
  }
}

// ── GitHub ────────────────────────────────────────────────────────────────────
function repoInfo() {
  // A Vercel injeta essas duas em todo deploy ligado a um repositório.
  const owner = process.env.VERCEL_GIT_REPO_OWNER || 'bragadaniel22';
  const repo = process.env.VERCEL_GIT_REPO_SLUG || 'Terminal---Ondina';
  return { owner, repo };
}

async function githubApi(caminho, token, opcoes = {}) {
  const r = await fetch(`https://api.github.com${caminho}`, {
    ...opcoes,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'terminal-financeiro-cron',
      ...(opcoes.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`GitHub ${r.status} em ${caminho}: ${texto.slice(0, 200)}`);
  return texto ? JSON.parse(texto) : null;
}

export default async function handler(req, res) {
  // A Vercel manda o CRON_SECRET como Bearer nas chamadas agendadas. Sem essa checagem o
  // endpoint ficaria aberto — e ele escreve no repositório.
  const segredo = process.env.CRON_SECRET;
  if (!segredo || req.headers.authorization !== `Bearer ${segredo}`) {
    return res.status(401).json({ error: 'não autorizado' });
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ error: 'GITHUB_TOKEN não configurado' });

  const { owner, repo } = repoInfo();
  const branch = process.env.VERCEL_GIT_COMMIT_REF || 'main';

  try {
    // 1. Estado atual, direto do repositório (não do bundle: o bundle é a foto do último deploy
    //    e ficaria velho entre uma captura e a seguinte).
    const atual = await githubApi(
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(ARQUIVO)}?ref=${branch}`, token);
    const historico = JSON.parse(Buffer.from(atual.content, 'base64').toString('utf8'));
    const jaTem = new Set((historico.snapshots || []).map((s) => s.date));

    // 2. Busca só o que falta, em paralelo.
    const janela = diasUteisPraTras(new Date(), JANELA_DIAS_UTEIS).filter((d) => !jaTem.has(d));
    const buscados = await Promise.all(janela.map(async (dt) => ({ dt, rates: await buscarDia(dt) })));
    const novos = buscados.filter((x) => x.rates).map((x) => ({ date: x.dt, rates: x.rates }));

    if (!novos.length) {
      return res.json({ ok: true, novos: 0, mensagem: 'nada novo na janela', verificados: janela.length });
    }

    // 3. Junta e ordena.
    historico.snapshots = (historico.snapshots || [])
      .concat(novos)
      .sort((a, b) => toDate(a.date) - toDate(b.date));
    historico.gerado = new Date().toISOString();
    historico.origem = 'captura automática (api/cron-ntnb.js)';

    // 4. Grava de volta. O `sha` do arquivo atual é obrigatório: é ele que impede sobrescrever
    //    uma alteração feita entre a leitura e a escrita.
    const datas = novos.map((n) => n.date).join(', ');
    await githubApi(`/repos/${owner}/${repo}/contents/${encodeURIComponent(ARQUIVO)}`, token, {
      method: 'PUT',
      body: JSON.stringify({
        message: `NTN-B: captura automatica de ${novos.length} dia(s) (${datas})`,
        content: Buffer.from(JSON.stringify(historico, null, 1), 'utf8').toString('base64'),
        sha: atual.sha,
        branch,
      }),
    });

    return res.json({ ok: true, novos: novos.length, datas: novos.map((n) => n.date) });
  } catch (e) {
    console.error('cron-ntnb', e);
    return res.status(500).json({ error: e.message });
  }
}
