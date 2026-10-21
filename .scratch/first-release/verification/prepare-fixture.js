'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const verificationRoot = __dirname;
const runtimeRoot = path.join(verificationRoot, 'runtime');
const fixtureRoot = path.join(runtimeRoot, 'workspace');
const manifestPath = path.join(runtimeRoot, 'manifest.json');
const evidenceDirectory = path.join(verificationRoot, 'evidence');
const files = {
  main: 'src/PriceCalculator.cs',
  caller: 'src/Checkout.cs',
  added: 'src/NewPrice.cs',
  deleted: 'src/LegacyPrice.cs',
};

function git(args, env) {
  return execFileSync('git', args, {
    cwd: fixtureRoot,
    encoding: 'utf8',
    env: env || process.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd();
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function snapshot() {
  const diskFiles = {};
  for (const relativePath of Object.values(files)) {
    const absolutePath = path.join(fixtureRoot, relativePath);
    diskFiles[relativePath] = fs.existsSync(absolutePath)
      ? { exists: true, sha256: digest(fs.readFileSync(absolutePath)) }
      : { exists: false };
  }
  return {
    head: git(['rev-parse', 'HEAD']),
    indexEntries: git(['ls-files', '--stage']),
    status: git(['status', '--porcelain=v1', '--untracked-files=all']),
    stagedDiffSha256: digest(git(['diff', '--cached', '--no-ext-diff', '--binary'])),
    unstagedDiffSha256: digest(git(['diff', '--no-ext-diff', '--binary'])),
    diskFiles,
  };
}

function save(relativePath, text) {
  const destination = path.resolve(fixtureRoot, relativePath);
  if (!destination.startsWith(fixtureRoot + path.sep)) {
    throw new Error('示例文件必须位于独立演示工程内。');
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, text, 'utf8');
}

function commit(message, date) {
  git(['add', '--all']);
  git(['-c', 'commit.gpgsign=false', 'commit', '-m', message], {
    ...process.env,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  });
  return git(['rev-parse', 'HEAD']);
}

function prepare() {
  const args = process.argv.slice(2);
  if (args.some((argument) => argument !== '--reuse')) {
    throw new Error('只接受 --reuse 参数；默认不会覆盖已有演示数据。');
  }
  if (fs.existsSync(runtimeRoot)) {
    if (!args.includes('--reuse')) {
      throw new Error('演示数据已经存在。需要保留已有运行结果时使用 --reuse；如需重建，请先自行移走 runtime 目录。');
    }
    if (!fs.existsSync(manifestPath)) {
      throw new Error('现有 runtime 目录缺少 manifest.json，不能直接复用；请检查或移走该目录后重建。');
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (path.resolve(manifest.fixtureRoot) !== fixtureRoot || !fs.existsSync(path.join(fixtureRoot, '.git'))) {
      throw new Error('现有演示工程的位置或 Git 目录不符合记录，不能复用。');
    }
    if (git(['rev-parse', 'HEAD']) !== manifest.afterCommit) {
      throw new Error('现有演示工程的 HEAD 已变化，不能当作原来的验证工程复用。');
    }
    console.log('复用已有演示工程，不覆盖文件、Git 状态或验证记录。');
    console.log(manifestPath);
    return;
  }

  fs.mkdirSync(fixtureRoot, { recursive: true });
  fs.mkdirSync(evidenceDirectory, { recursive: true });
  git(['init', '-b', 'main']);
  git(['config', 'user.name', 'XGH']);
  git(['config', 'user.email', 'xgh@example.com']);
  git(['config', 'core.autocrlf', 'false']);
  git(['config', 'core.safecrlf', 'false']);

  const before = `public static class PriceCalculator
{
    public static int GetPrice(int price, int quantity)
    {
        return price * quantity;
    }
}
`;
  const after = `public static class PriceCalculator
{
    public static int GetPrice(int price, int quantity)
    {
        if (quantity <= 0)
        {
            return 0;
        }

        int total = price * quantity;
        return total;
    }
}
`;
  const caller = `public static class Checkout
{
    public static int GetTotal(int price, int quantity)
    {
        return PriceCalculator.GetPrice(price, quantity);
    }
}
`;
  const legacy = `public static class LegacyPrice
{
    public static int GetPrice(int price, int quantity)
    {
        return price * quantity;
    }
}
`;
  const added = `public static class NewPrice
{
    public static int GetPrice()
    {
        return 0;
    }
}
`;
  save(files.main, before);
  save(files.caller, caller);
  save(files.deleted, legacy);
  const beforeCommit = commit('验证示例：直接计算价格和旧文件', '2026-10-21T13:00:00+08:00');

  save(files.main, after);
  save(files.added, added);
  const deletedPath = path.resolve(fixtureRoot, files.deleted);
  if (!deletedPath.startsWith(fixtureRoot + path.sep)) {
    throw new Error('待移除文件必须位于独立演示工程内。');
  }
  fs.unlinkSync(deletedPath);
  const afterCommit = commit('验证示例：检查数量并新增和删除文件', '2026-10-21T13:01:00+08:00');

  const staged = after.replace('quantity <= 0)', 'quantity <= 0 || price < 0)');
  save(files.main, staged);
  git(['add', '--', files.main]);
  save(files.main, staged.replace('int total = price * quantity;', 'int total = checked(price * quantity);'));

  const manifest = {
    fixtureRoot,
    beforeCommit,
    afterCommit,
    evidenceDirectory,
    files,
    unsavedEdit: {
      path: files.main,
      find: 'return total;',
      replace: 'return total + 1;',
    },
    targets: {
      caller: { startLine: 5, endLine: 5 },
      removedReturn: { startLine: 5, endLine: 5 },
      addedGuard: { startLine: 5, endLine: 8 },
      addedTotal: { startLine: 10, endLine: 11 },
      currentCondition: { startLine: 5, endLine: 5 },
      currentCalculation: { startLine: 10, endLine: 11 },
      wholeAdded: { startLine: 5, endLine: 5 },
      wholeDeleted: { startLine: 5, endLine: 5 },
    },
    preparedBaseline: snapshot(),
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(runtimeRoot, 'prepared-baseline.json'), JSON.stringify(manifest.preparedBaseline, null, 2) + '\n', 'utf8');
  console.log('独立演示工程已准备，包含两个提交、已暂存修改和未暂存修改。');
  console.log('未保存修改由 VS Code 内的准备命令创建，随后再记录阅读前状态。');
  console.log(manifestPath);
}

try {
  prepare();
} catch (error) {
  const detail = error.stderr ? String(error.stderr).trim() : error.message;
  console.error('无法准备验证工程：' + detail);
  process.exitCode = 1;
}
