const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

exports.activate = async context => {
  const root = process.env.CODE_EXPLANATION_BACKGROUND_RUN;
  if (!root) return;
  const inside = value => path.resolve(value).toLowerCase().startsWith(path.resolve(root).toLowerCase() + path.sep);
  const extension = vscode.extensions.getExtension('XGH.code-explanation-extension');
  const project = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const phase = process.env.CODE_EXPLANATION_BACKGROUND_PHASE;
  if (!extension || !inside(extension.extensionPath) ||
    (phase === 'no-project' ? !!vscode.workspace.workspaceFolders?.length || !!vscode.workspace.workspaceFile : !project || !inside(project))) {
    throw new Error('项目或被测扩展不在独立后台目录内，未执行测试或关闭窗口。');
  }
  const config = JSON.parse(fs.readFileSync(path.join(root, 'configuration.json'), 'utf8').replace(/^\uFEFF/, ''));
  const expected = phase === 'project' ? config.otherProject : path.join(config.fixture, 'project');
  if (phase !== 'no-project' && path.resolve(project).toLowerCase() !== path.resolve(expected).toLowerCase()) return;
  if (phase === 'multiple-roots') {
    const folders = vscode.workspace.workspaceFolders;
    if (folders.length !== 2 || !inside(vscode.workspace.workspaceFile?.fsPath || '') ||
      path.resolve(folders[1].uri.fsPath).toLowerCase() !== path.resolve(config.otherProject).toLowerCase()) return;
  }
  try {
    await require('./run.cjs').run();
    await context.globalState.update('completed-phase', process.env.CODE_EXPLANATION_BACKGROUND_PHASE || 'main');
  } catch (error) {
    fs.writeFileSync(path.join(root, 'driver-error.json'), JSON.stringify({ error: error.stack }, null, 2));
  } finally {
    // 只退出已核实归本次独立目录管理的 VS Code 实例。
    void vscode.commands.executeCommand('workbench.action.quit');
  }
};
