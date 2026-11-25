// Gera "Katharos Nous.exe": copia do electron.exe com o nome, a descricao e o icone do Katharos.
// O Windows (Gerenciador de Tarefas, mixer de volume, firewall, notificacoes) mostra o nome
// gravado no proprio .exe em execucao; app.name e o titulo da janela nao chegam la.
// Roda sozinho depois de `npm install` (postinstall) e sob demanda com `npm run brand`.
// O Katharos.exe abre esta copia quando ela existe; se nao existir, usa o electron.exe normal.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const APP_NAME = 'Katharos Nous';
const CODE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = path.join(CODE_DIR, 'node_modules', 'electron', 'dist');
const SOURCE_EXE = path.join(DIST_DIR, 'electron.exe');
const TARGET_EXE = path.join(DIST_DIR, `${APP_NAME}.exe`);
const STAMP_FILE = path.join(DIST_DIR, 'katharos-brand.json');
const ICON_FILE = path.join(CODE_DIR, 'assets', 'icon.ico');
const FROM_POSTINSTALL = process.argv.includes('--postinstall');

const pkg = JSON.parse(fs.readFileSync(path.join(CODE_DIR, 'package.json'), 'utf8'));
const author = pkg.author || 'DevFLeo';
const version = String(pkg.version || '1.0.0');

const IDENTITY = {
  FileDescription: APP_NAME,
  ProductName: APP_NAME,
  CompanyName: author,
  LegalCopyright: `Copyright (c) ${author}`,
  InternalName: APP_NAME,
  OriginalFilename: `${APP_NAME}.exe`
};

function log(msg) {
  console.log(`[Katharos] ${msg}`);
}

function fingerprint() {
  const source = fs.statSync(SOURCE_EXE);
  const icon = fs.existsSync(ICON_FILE)
    ? crypto.createHash('sha256').update(fs.readFileSync(ICON_FILE)).digest('hex')
    : null;
  return JSON.stringify({ size: source.size, mtimeMs: Math.round(source.mtimeMs), icon, version, IDENTITY });
}

function isUpToDate(current) {
  try {
    return fs.existsSync(TARGET_EXE) && fs.readFileSync(STAMP_FILE, 'utf8') === current;
  } catch (_) {
    return false;
  }
}

async function brand() {
  if (!fs.existsSync(SOURCE_EXE)) {
    log('electron.exe nao encontrado em node_modules; nada a fazer.');
    return;
  }

  const current = fingerprint();
  if (isUpToDate(current)) {
    log(`"${APP_NAME}.exe" ja esta pronto.`);
    return;
  }

  const ResEdit = await import('resedit');
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(SOURCE_EXE), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);

  const [info] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (!info) throw new Error('electron.exe sem informacoes de versao');
  for (const language of info.getAllLanguagesForStringValues()) {
    info.setStringValues(language, IDENTITY);
    info.setFileVersion(version, language.lang);
    info.setProductVersion(version, language.lang);
  }
  info.outputToResourceEntries(res.entries);

  if (fs.existsSync(ICON_FILE)) {
    const [mainIcon] = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
    const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(ICON_FILE));
    if (mainIcon) {
      ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
        res.entries,
        mainIcon.id,
        mainIcon.lang,
        iconFile.icons.map((item) => item.data)
      );
    }
  }

  res.outputResource(exe);
  const tmp = `${TARGET_EXE}.tmp`;
  fs.writeFileSync(tmp, Buffer.from(exe.generate()));
  fs.renameSync(tmp, TARGET_EXE);
  fs.writeFileSync(STAMP_FILE, current);
  log(`"${APP_NAME}.exe" gerado em ${DIST_DIR}`);
}

try {
  await brand();
} catch (err) {
  const locked = err && (err.code === 'EBUSY' || err.code === 'EPERM');
  log(`Nao foi possivel gerar "${APP_NAME}.exe": ${err && err.message ? err.message : err}`);
  if (locked) log('Feche o Katharos (bandeja > Sair) e rode: npm run brand');
  try { fs.rmSync(`${TARGET_EXE}.tmp`, { force: true }); } catch (_) {}
  // No postinstall nao derruba o npm install; o Katharos.exe volta a usar o electron.exe
  process.exitCode = FROM_POSTINSTALL ? 0 : 1;
}
