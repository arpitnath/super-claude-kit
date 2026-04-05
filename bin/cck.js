#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, rmSync, statSync, symlinkSync, lstatSync, readlinkSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = join(__dirname, '..');
const CLAUDE_DIR = join(process.env.HOME, '.claude');
const CCK_DIR = join(CLAUDE_DIR, 'cck');
const SETTINGS_PATH = join(CLAUDE_DIR, 'settings.json');
const CLAUDE_MD_PATH = join(CLAUDE_DIR, 'CLAUDE.md');
const CAPSULE_DB_PATH = join(CLAUDE_DIR, 'capsule.db');
const BIN_DIR = join(CLAUDE_DIR, 'bin');

const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;

const command = process.argv[2];

const commands = { setup, teardown, status, version, update, prune, crew, stats, build, map };

if (!command || !commands[command]) {
  console.log(`cck v${VERSION} - Claude Capsule Kit`);
  console.log('A toolkit that makes Claude Code better at engineering.');
  console.log('');
  console.log('Session memory, dependency tools, large file navigation,');
  console.log('18 specialist agents, and crew teams for parallel multi-branch work.');
  console.log('');
  console.log('Commands:');
  console.log('  cck setup              Install hooks, tools, and context system');
  console.log('  cck teardown           Remove CCK (keeps capsule.db user data)');
  console.log('  cck status             Show installation status');
  console.log('  cck version            Print version');
  console.log('  cck update             Update if version changed');
  console.log('  cck build              Build Go binaries (dependency-scanner, progressive-reader)');
  console.log('  cck stats <cmd>        Usage analytics (overview|files|agents|sessions|branch)');
  console.log('  cck prune [days]       Remove old records (default: 30 days)');
  console.log('  cck crew <cmd>         Crew teams (init|start|stop|status|doctor|merge|gc|...)');
  console.log('  cck map <cmd>          Codebase map (init|status|show|update|hot|stubs)');
  console.log('');
  console.log('https://github.com/arpitnath/claude-capsule-kit');
  process.exit(command ? 1 : 0);
}

try {
  await commands[command]();
} catch (err) {
  console.error(`Error running '${command}': ${err.message}`);
  process.exit(1);
}

function setup() {
  console.log(`Setting up CCK v${VERSION}...`);

  mkdirSync(CCK_DIR, { recursive: true });

  const assetDirs = ['hooks', 'tools', 'lib', 'agents', 'skills', 'commands', 'crew', 'templates'];
  for (const dir of assetDirs) {
    const src = join(PKG_ROOT, dir);
    const dest = join(CCK_DIR, dir);
    if (existsSync(src)) {
      // Clean dest first to remove stale files not in source
      if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
      cpSync(src, dest, { recursive: true });
      console.log(`  Copied ${dir}/`);
    }
  }

  // Symlink agents, skills, commands into ~/.claude/ for Claude Code discovery
  for (const dir of ['agents', 'skills', 'commands']) {
    const target = join(CCK_DIR, dir);
    const link = join(CLAUDE_DIR, dir);
    if (!existsSync(target)) continue;
    try {
      const stat = lstatSync(link);
      if (stat.isSymbolicLink()) {
        if (readlinkSync(link) === target) continue;
        rmSync(link);
      } else {
        rmSync(link, { recursive: true, force: true });
      }
    } catch { /* doesn't exist */ }
    symlinkSync(target, link);
    console.log(`  Linked ${dir}/ → ~/.claude/${dir}/`);
  }

  writeFileSync(join(CCK_DIR, 'package.json'), JSON.stringify({ type: 'module', version: VERSION }, null, 2) + '\n');

  console.log('  Installing blink-query...');
  try {
    execSync('npm install blink-query', { cwd: CCK_DIR, stdio: 'pipe' });
    console.log('  blink-query installed');
  } catch {
    try {
      // Fallback: local link for development
      execSync('npm link blink-query', { cwd: CCK_DIR, stdio: 'pipe' });
      console.log('  blink-query linked (local dev)');
    } catch {
      console.warn('  Warning: Failed to install blink-query.');
      console.warn('  Run: cd ~/.claude/cck && npm install blink-query');
    }
  }

  const hooksTemplate = JSON.parse(readFileSync(join(PKG_ROOT, 'templates', 'settings-hooks.json'), 'utf8'));
  let settings = {};
  if (existsSync(SETTINGS_PATH)) {
    try {
      settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
    } catch {
      // Start fresh if settings.json is malformed
    }
  }

  // Clean stale CCK hooks from previous versions before merging new ones.
  // Old v2 hooks referenced paths like .claude/hooks/session-start.sh or
  // .claude/cck/hooks/pre-task-analysis.sh that no longer exist in v3.
  if (settings.hooks) {
    const cckPathPatterns = ['.claude/hooks/', '.claude/cck/hooks/'];
    for (const [event, matchers] of Object.entries(settings.hooks)) {
      if (!Array.isArray(matchers)) continue;
      for (const matcher of matchers) {
        if (!matcher.hooks || !Array.isArray(matcher.hooks)) continue;
        matcher.hooks = matcher.hooks.filter(hook => {
          const cmd = hook.command || '';
          const isCckHook = cckPathPatterns.some(p => cmd.includes(p));
          return !isCckHook; // Keep non-CCK hooks, remove old CCK hooks
        });
      }
      // Remove matchers with no hooks left
      settings.hooks[event] = matchers.filter(m => m.hooks && m.hooks.length > 0);
      if (settings.hooks[event].length === 0) delete settings.hooks[event];
    }
  }

  // Merge CCK hooks into existing hooks (preserve user's non-CCK hooks)
  if (!settings.hooks) {
    settings.hooks = {};
  }
  settings.hooks = { ...settings.hooks, ...hooksTemplate };

  // Install statusline
  const statuslineSrc = join(PKG_ROOT, 'templates', 'statusline-command.sh');
  const statuslineDst = join(CLAUDE_DIR, 'statusline-command.sh');
  if (existsSync(statuslineSrc)) {
    cpSync(statuslineSrc, statuslineDst);
    if (!settings.statusLine) {
      settings.statusLine = {};
    }
    settings.statusLine.type = 'command';
    settings.statusLine.command = `bash ${statuslineDst}`;
    console.log('  Statusline installed');
  }

  mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
  console.log('  Hooks registered in settings.json');

  const claudeMdSrc = join(PKG_ROOT, 'templates', 'CLAUDE.md');
  if (existsSync(claudeMdSrc)) {
    if (existsSync(CLAUDE_MD_PATH)) {
      const existing = readFileSync(CLAUDE_MD_PATH, 'utf8');
      // Only overwrite if it's a CCK-managed CLAUDE.md (has our header)
      if (existing.includes('# Capsule Kit') || existing.includes('# Claude Capsule Kit') || existing.includes('capsule.db')) {
        cpSync(claudeMdSrc, CLAUDE_MD_PATH);
        console.log('  CLAUDE.md updated');
      } else {
        console.log('  CLAUDE.md skipped (user-customized, not overwriting)');
        console.log('  CCK CLAUDE.md saved to: ~/.claude/cck/templates/CLAUDE.md');
      }
    } else {
      cpSync(claudeMdSrc, CLAUDE_MD_PATH);
      console.log('  CLAUDE.md installed');
    }
  }

  mkdirSync(BIN_DIR, { recursive: true });
  try {
    execSync('go version', { stdio: 'pipe' });
    console.log('  Go detected, building binaries...');

    const goBinaries = [
      { name: 'dependency-scanner', src: join(PKG_ROOT, 'tools', 'dependency-scanner'), pkg: '.' },
      { name: 'progressive-reader', src: join(PKG_ROOT, 'tools', 'progressive-reader'), pkg: './cmd/' },
    ];

    for (const bin of goBinaries) {
      if (existsSync(bin.src)) {
        try {
          execSync(`go build -o ${join(BIN_DIR, bin.name)} ${bin.pkg}`, { cwd: bin.src, stdio: 'pipe' });
          console.log(`  Built ${bin.name}`);
        } catch {
          console.warn(`  Warning: Failed to build ${bin.name}`);
        }
      }
    }
  } catch {
    console.log('  Go not found, skipping binary builds (optional)');
  }

  // Detect old per-project .claude/ artifacts from v1/v2
  const localClaudeDir = resolve(process.cwd(), '.claude');
  const v2Markers = [
    join(localClaudeDir, '.super-claude-version'),
    join(localClaudeDir, 'capsule.db'),
    join(localClaudeDir, 'blink.db'),
  ];
  const hasV2Artifacts = v2Markers.some(p => existsSync(p));
  const hasLocalHooks = existsSync(join(localClaudeDir, 'hooks'));
  const hasLocalAgents = existsSync(join(localClaudeDir, 'agents'));

  if (hasV2Artifacts || hasLocalHooks || hasLocalAgents) {
    console.log('');
    console.log('  Migration note: Found old per-project .claude/ artifacts.');
    console.log('  CCK v3 is fully global — project-local .claude/ files are no longer used.');
    if (existsSync(join(localClaudeDir, 'capsule.db')) || existsSync(join(localClaudeDir, 'blink.db'))) {
      console.log('  Your old session data in .claude/capsule.db can be safely removed.');
      console.log('  New data is stored in ~/.claude/capsule.db');
    }
    if (hasLocalHooks) {
      console.log('  Old hooks in .claude/hooks/ are inactive — hooks now run from ~/.claude/cck/hooks/');
    }
    console.log('  To clean up: rm -rf .claude/hooks .claude/tools .claude/agents .claude/skills .claude/scripts .claude/lib .claude/.super-claude-version');
  }

  console.log('');
  console.log(`CCK v${VERSION} setup complete!`);
  console.log('');
  console.log('Crew Mode (Agent Teams):');
  console.log('  To use /crew for parallel multi-branch teams, enable Agent Teams in Claude Code.');
  console.log('  Setup guide: https://code.claude.com/docs/en/agent-teams');
}

function build() {
  console.log('Building Go binaries...');

  try {
    execSync('go version', { stdio: 'pipe' });
  } catch {
    console.error('Error: Go is not installed. Install Go 1.20+ from https://go.dev/dl/');
    process.exit(1);
  }

  mkdirSync(BIN_DIR, { recursive: true });

  // Try CCK install dir first, fall back to package source
  const toolsDir = existsSync(join(CCK_DIR, 'tools')) ? join(CCK_DIR, 'tools') : join(PKG_ROOT, 'tools');
  const goBinaries = [
    { name: 'dependency-scanner', src: join(toolsDir, 'dependency-scanner'), pkg: '.' },
    { name: 'progressive-reader', src: join(toolsDir, 'progressive-reader'), pkg: './cmd/' },
  ];

  let built = 0;
  for (const bin of goBinaries) {
    if (!existsSync(bin.src)) {
      console.warn(`  Skipping ${bin.name} (Go source not found at ${bin.src})`);
      continue;
    }
    // Check for Go source files
    if (!existsSync(join(bin.src, 'go.mod'))) {
      console.warn(`  Skipping ${bin.name} (no go.mod — Go source not included in npm package)`);
      console.warn(`  To build, clone the repo: https://github.com/anthropics/claude-capsule-kit`);
      continue;
    }
    try {
      execSync(`go build -o ${join(BIN_DIR, bin.name)} ${bin.pkg}`, { cwd: bin.src, stdio: 'pipe' });
      console.log(`  Built ${bin.name} → ${join(BIN_DIR, bin.name)}`);
      built++;
    } catch (err) {
      console.error(`  Failed to build ${bin.name}: ${err.message}`);
    }
  }

  if (built > 0) {
    console.log(`\n${built} binaries built successfully.`);
  } else {
    console.log('\nNo binaries built. Go source files are not included in the npm package.');
    console.log('Clone the repo and run `cck build` from the source directory.');
  }
}

function teardown() {
  console.log('Tearing down CCK...');

  // Remove symlinks first (before removing cck/ which is their target)
  for (const dir of ['agents', 'skills', 'commands']) {
    const link = join(CLAUDE_DIR, dir);
    try {
      if (lstatSync(link).isSymbolicLink()) {
        rmSync(link);
        console.log(`  Removed ~/.claude/${dir} symlink`);
      }
    } catch { /* not a symlink or doesn't exist */ }
  }

  if (existsSync(CCK_DIR)) {
    rmSync(CCK_DIR, { recursive: true, force: true });
    console.log('  Removed ~/.claude/cck/');
  }

  if (existsSync(BIN_DIR)) {
    rmSync(BIN_DIR, { recursive: true, force: true });
    console.log('  Removed ~/.claude/bin/');
  }

  if (existsSync(SETTINGS_PATH)) {
    try {
      const settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
      // Remove only CCK hooks, preserve user's non-CCK hooks
      if (settings.hooks) {
        const cckPathPatterns = ['.claude/hooks/', '.claude/cck/hooks/'];
        for (const [event, matchers] of Object.entries(settings.hooks)) {
          if (!Array.isArray(matchers)) continue;
          for (const matcher of matchers) {
            if (!matcher.hooks || !Array.isArray(matcher.hooks)) continue;
            matcher.hooks = matcher.hooks.filter(hook => {
              const cmd = hook.command || '';
              return !cckPathPatterns.some(p => cmd.includes(p));
            });
          }
          settings.hooks[event] = matchers.filter(m => m.hooks && m.hooks.length > 0);
          if (settings.hooks[event].length === 0) delete settings.hooks[event];
        }
        if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
      }
      // Remove statusline if it points to our script
      if (settings.statusLine?.command?.includes('statusline-command.sh')) {
        delete settings.statusLine;
        console.log('  Removed statusline from settings.json');
      }
      writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
      console.log('  Removed CCK hooks from settings.json');
    } catch {
      console.warn('  Warning: Could not update settings.json');
    }
  }

  // Remove statusline script
  const statuslineFile = join(CLAUDE_DIR, 'statusline-command.sh');
  if (existsSync(statuslineFile)) {
    rmSync(statuslineFile);
    console.log('  Removed statusline script');
  }

  if (existsSync(CLAUDE_MD_PATH)) {
    rmSync(CLAUDE_MD_PATH);
    console.log('  Removed ~/.claude/CLAUDE.md');
  }

  // Note: capsule.db is intentionally preserved
  if (existsSync(CAPSULE_DB_PATH)) {
    console.log('  Kept ~/.claude/capsule.db (user data preserved)');
  }

  console.log('');
  console.log('CCK teardown complete.');
}

function status() {
  console.log(`CCK v${VERSION} Status`);
  console.log('─'.repeat(40));

  const hooksDir = join(CCK_DIR, 'hooks');
  console.log(`  Hooks directory:  ${existsSync(hooksDir) ? 'installed' : 'not found'}`);

  let hooksRegistered = false;
  if (existsSync(SETTINGS_PATH)) {
    try {
      const settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
      hooksRegistered = !!settings.hooks && Object.keys(settings.hooks).length > 0;
    } catch {}
  }
  console.log(`  Hooks registered: ${hooksRegistered ? 'yes' : 'no'}`);

  if (existsSync(CAPSULE_DB_PATH)) {
    const stats = statSync(CAPSULE_DB_PATH);
    const sizeKB = (stats.size / 1024).toFixed(1);
    console.log(`  Capsule database: ${sizeKB} KB`);
  } else {
    console.log('  Capsule database: not created yet');
  }

  // Agents, skills, commands
  for (const dir of ['agents', 'skills', 'commands']) {
    const link = join(CLAUDE_DIR, dir);
    try {
      const isLink = lstatSync(link).isSymbolicLink();
      console.log(`  ${dir.padEnd(18)} ${isLink ? 'linked' : 'exists (not symlink)'}`);
    } catch {
      console.log(`  ${dir.padEnd(18)} not found`);
    }
  }

  // Crew and templates directories
  for (const dir of ['crew', 'templates']) {
    const path = join(CCK_DIR, dir);
    console.log(`  ${dir.padEnd(18)} ${existsSync(path) ? 'installed' : 'not found'}`);
  }

  const depScanner = join(BIN_DIR, 'dependency-scanner');
  const progReader = join(BIN_DIR, 'progressive-reader');
  console.log(`  dep-scanner:      ${existsSync(depScanner) ? 'installed' : 'not found'}`);
  console.log(`  progressive-reader: ${existsSync(progReader) ? 'installed' : 'not found'}`);
}

function version() {
  console.log(`cck v${VERSION}`);
}

function update() {
  // Check if CCK is installed
  const installedPkgPath = join(CCK_DIR, 'package.json');

  if (!existsSync(CCK_DIR) || !existsSync(installedPkgPath)) {
    console.log('CCK is not installed yet. Run "cck setup" first.');
    return;
  }

  // Read installed version from the marker package.json
  let installedVersion = null;
  try {
    const installedPkg = JSON.parse(readFileSync(installedPkgPath, 'utf8'));
    installedVersion = installedPkg.version;
  } catch {
    // No version in installed package.json
  }

  if (!installedVersion) {
    console.log('Cannot determine installed version. Re-running setup...');
    setup();
    return;
  }

  if (installedVersion === VERSION) {
    console.log(`CCK is up to date (v${VERSION}).`);
    return;
  }

  console.log(`Updating CCK: v${installedVersion} → v${VERSION}`);
  console.log('');

  // Re-run setup
  setup();

  console.log('');
  console.log('Update complete.');
}

async function crew() {
  const sub = process.argv[3];
  const subs = {
    init: crewInit,
    start: crewStart,
    stop: crewStop,
    status: crewStatus,
    decompose: crewDecompose,
    discoveries: crewDiscoveries,
    activity: crewActivity,
    'merge-preview': crewMergePreview,
    merge: crewMerge,
    doctor: crewDoctor,
    gc: crewGc
  };

  if (!sub || !subs[sub]) {
    console.log('Usage: cck crew <command>');
    console.log('');
    console.log('Commands:');
    console.log('  cck crew init                     Create .crew-config.json in current directory');
    console.log('  cck crew decompose [paths]        Analyze dependencies and suggest crew config');
    console.log('  cck crew start [profile]          Launch team (setup worktrees, generate lead prompt)');
    console.log('  cck crew stop [profile]           Stop team (removes worktrees by default)');
    console.log('  cck crew status [profile]         Show team state (all profiles if omitted)');
    console.log('  cck crew doctor [profile]         Check teammate health (detect crashed/hung teammates)');
    console.log('  cck crew activity [profile]       Show recent file operations and detect overlaps');
    console.log('  cck crew gc [--branches] [--force] Clean up orphaned worktrees');
    console.log('  cck crew discoveries [limit]      List shared team discoveries (default: 20)');
    console.log('  cck crew merge-preview [profile]  Preview branch merges (conflicts, changed files)');
    console.log('  cck crew merge [profile]          Execute branch merges after preview and confirmation');
    console.log('');
    console.log('Crew grouping:');
    console.log('  --crew <name>                     Filter by crew group (e.g. --crew frontend)');
    console.log('  Supported by: merge-preview, merge, doctor, activity, discoveries');
    process.exit(sub ? 1 : 0);
  }

  await subs[sub]();
}

async function crewInit() {
  const dest = resolve(process.cwd(), '.crew-config.json');
  if (existsSync(dest)) {
    console.log('.crew-config.json already exists. Edit it directly.');
    return;
  }

  const template = JSON.parse(readFileSync(join(PKG_ROOT, 'templates', 'crew-config.json'), 'utf8'));

  // Auto-detect main branch
  let mainBranch = 'main';
  try {
    mainBranch = execSync('git symbolic-ref refs/remotes/origin/HEAD', {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
    }).trim().replace('refs/remotes/origin/', '');
  } catch {
    try {
      // Fallback: check if 'main' or 'master' exists
      execSync('git rev-parse --verify main', { stdio: 'pipe' });
      mainBranch = 'main';
    } catch {
      try {
        execSync('git rev-parse --verify master', { stdio: 'pipe' });
        mainBranch = 'master';
      } catch {
        mainBranch = 'main';
      }
    }
  }

  template.project.main_branch = mainBranch;
  writeFileSync(dest, JSON.stringify(template, null, 2) + '\n');

  console.log('Created .crew-config.json');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Edit .crew-config.json — set team name, add teammates');
  console.log('  2. Run: cck crew start');
}

/** Parse --crew <name> from argv */
function parseCrewFilter() {
  const idx = process.argv.indexOf('--crew');
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  return null;
}

async function crewStart() {
  const { loadCrewConfig, hashConfig, validateConfig, resolveWorktreePath, resolveProfile } = await import(
    join(PKG_ROOT, 'crew', 'lib', 'crew-config-reader.js')
  );
  const { resolveRole } = await import(
    join(PKG_ROOT, 'crew', 'lib', 'role-presets.js')
  );
  const { loadTeamState, saveTeamState, isStale: isTeammateStale, isConfigChanged } = await import(
    join(PKG_ROOT, 'crew', 'lib', 'team-state-manager.js')
  );
  const { generateLeadPrompt } = await import(
    join(PKG_ROOT, 'crew', 'lib', 'prompt-generator.js')
  );
  const { getProjectHash } = await import(
    join(PKG_ROOT, 'hooks', 'lib', 'crew-detect.js')
  );

  const projectRoot = process.cwd();
  const fresh = process.argv.includes('--fresh');
  // Profile name: first non-flag arg after "crew start"
  const profileArg = process.argv.slice(4).find(a => !a.startsWith('--'));

  // 1. Load and validate config
  let config;
  try {
    config = loadCrewConfig(projectRoot);
  } catch (err) {
    console.error('Failed to load .crew-config.json:', err.message);
    console.error('Run "cck crew init" first.');
    process.exit(1);
  }

  const errors = validateConfig(config);
  if (errors.length > 0) {
    console.error('Invalid .crew-config.json:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  // 2. Resolve profile
  let profile, profileName;
  try {
    ({ profile, profileName } = resolveProfile(config, profileArg));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  // Resolve teammates (supports both flat and crews grouping)
  const { resolveTeammates } = await import(
    join(PKG_ROOT, 'crew', 'lib', 'crew-config-reader.js')
  );
  const flatTeammates = resolveTeammates(profile);
  const resolvedTeammates = flatTeammates.map(resolveRole);
  const team = { ...profile, teammates: resolvedTeammates };

  // 3. Compute hashes and load state
  const projectHash = getProjectHash();
  const configHash = hashConfig(config);
  const existingState = loadTeamState(projectHash, profileName);

  // 4. Determine staleness threshold (profile > top-level > default 4h)
  const staleAfterHours = profile.stale_after_hours ?? config.stale_after_hours ?? 4;
  const staleAfterMs = staleAfterHours * 3600000;

  // 5. Resume decision
  let shouldResume = false;
  if (fresh) {
    console.log('--fresh flag: starting fresh team session.');
  } else if (existingState) {
    if (isConfigChanged(configHash, existingState.config_hash)) {
      console.log('Config changed since last session. Starting fresh.');
    } else {
      const anyActive = existingState.teammates &&
        Object.values(existingState.teammates).some(t => !isTeammateStale(t, staleAfterMs));
      if (anyActive) {
        shouldResume = true;
        console.log('Resumable team session found.');
      } else {
        console.log(`Previous session is stale (>${staleAfterHours}h). Starting fresh.`);
      }
    }
  }

  // 6. Check for orphaned worktrees and warn
  const { findOrphans } = await import(
    join(PKG_ROOT, 'crew', 'lib', 'worktree-gc.js')
  );

  try {
    const orphans = findOrphans();
    if (orphans.length > 0) {
      console.log('');
      console.log(`⚠ Warning: Found ${orphans.length} orphaned worktree${orphans.length > 1 ? 's' : ''} from previous sessions.`);
      console.log('  Run "cck crew gc" to clean them up and free disk space.');
      console.log('');
    }
  } catch {
    // Silently ignore orphan check errors
  }

  // 7. Setup worktrees
  const worktreePaths = { _projectRoot: projectRoot };

  for (const mate of team.teammates) {
    if (!mate.worktree) continue;

    const wtPath = resolveWorktreePath(projectRoot, mate.branch, profileName);
    worktreePaths[mate.name] = wtPath;

    if (existsSync(wtPath)) {
      console.log(`  Worktree exists: ${wtPath}`);
    } else {
      console.log(`  Creating worktree: ${wtPath} (branch: ${mate.branch})`);
      try {
        execSync(`git worktree add "${wtPath}" "${mate.branch}"`, {
          cwd: projectRoot, stdio: 'pipe'
        });
      } catch {
        try {
          const mainBranch = config.project?.main_branch || 'main';
          execSync(`git worktree add -b "${mate.branch}" "${wtPath}" "${mainBranch}"`, {
            cwd: projectRoot, stdio: 'pipe'
          });
        } catch (err) {
          console.error(`  Failed to create worktree for ${mate.name}: ${err.message}`);
          continue;
        }
      }
    }

    // Write crew-identity.json in worktree root
    const identity = {
      teammate_name: mate.name,
      crew_name: mate.crew || 'default',
      project_root: projectRoot,
      branch: mate.branch,
      team_name: team.name,
      profile_name: profileName,
      created_at: new Date().toISOString()
    };
    writeFileSync(resolve(wtPath, 'crew-identity.json'), JSON.stringify(identity, null, 2) + '\n');
  }

  // 8. Write worktrees.json
  const crewDir = resolve(homedir(), '.claude', 'crew', projectHash);
  mkdirSync(crewDir, { recursive: true });
  const worktreeEntries = team.teammates
    .filter(m => m.worktree && worktreePaths[m.name])
    .map(m => ({
      name: m.name,
      branch: m.branch,
      path: worktreePaths[m.name]
    }));
  writeFileSync(
    resolve(crewDir, 'worktrees.json'),
    JSON.stringify({ worktrees: worktreeEntries }, null, 2) + '\n'
  );

  // 9. Generate lead prompt (pass resolved team and staleness threshold)
  const teamState = shouldResume ? existingState : null;
  const prompt = generateLeadPrompt(team, teamState, worktreePaths, configHash, staleAfterMs);

  // 10. Save state
  const newState = {
    team_name: team.name,
    profile_name: profileName,
    config_hash: configHash,
    status: 'active',
    started_at: shouldResume ? (existingState.started_at || new Date().toISOString()) : new Date().toISOString(),
    updated_at: new Date().toISOString(),
    teammates: {}
  };

  for (const mate of team.teammates) {
    const prev = existingState?.teammates?.[mate.name];
    newState.teammates[mate.name] = {
      branch: mate.branch,
      worktree_path: worktreePaths[mate.name] || null,
      status: shouldResume && prev ? prev.status : 'pending',
      agent_id: shouldResume && prev ? prev.agent_id : null,
      last_active: shouldResume && prev ? prev.last_active : null
    };
  }

  saveTeamState(projectHash, newState, profileName);

  // 11. Output prompt
  const promptPath = resolve(crewDir, profileName, 'lead-prompt.md');
  mkdirSync(resolve(crewDir, profileName), { recursive: true });
  writeFileSync(promptPath, prompt + '\n');

  console.log('');
  console.log(`Team "${team.name}" (profile: ${profileName}) ready.`);
  console.log(`Lead prompt saved to: ${promptPath}`);
  console.log('');
  console.log('Copy the prompt below and paste it into Claude Code to launch the team:');
  console.log('─'.repeat(60));
  console.log(prompt);
}

async function crewStop() {
  const { loadCrewConfig, resolveProfile } = await import(
    join(PKG_ROOT, 'crew', 'lib', 'crew-config-reader.js')
  );
  const { loadTeamState, saveTeamState, listProfiles } = await import(
    join(PKG_ROOT, 'crew', 'lib', 'team-state-manager.js')
  );
  const { getProjectHash } = await import(
    join(PKG_ROOT, 'hooks', 'lib', 'crew-detect.js')
  );

  const projectRoot = process.cwd();
  const projectHash = getProjectHash();
  // FLIPPED: now cleanup by default, --keep-worktrees to preserve
  const keepWorktrees = process.argv.includes('--keep-worktrees');
  const profileArg = process.argv.slice(4).find(a => !a.startsWith('--'));

  // Determine which profile(s) to stop
  let profilesToStop = [];
  if (profileArg) {
    profilesToStop = [profileArg];
  } else {
    // Try to resolve from config, fall back to 'default'
    try {
      const config = loadCrewConfig(projectRoot);
      const { profileName } = resolveProfile(config);
      profilesToStop = [profileName];
    } catch {
      profilesToStop = ['default'];
    }
  }

  for (const pName of profilesToStop) {
    const state = loadTeamState(projectHash, pName);
    if (!state) {
      console.log(`No active team session found for profile "${pName}".`);
      continue;
    }

    for (const name of Object.keys(state.teammates || {})) {
      state.teammates[name].status = 'stopped';
    }
    state.status = 'stopped';
    saveTeamState(projectHash, state, pName);
    console.log(`Team "${state.team_name}" (profile: ${pName}) stopped.`);

    // Clean up crew-identity.json files (from worktrees and project root)
    for (const [name, mate] of Object.entries(state.teammates || {})) {
      if (mate.worktree_path) {
        const wtIdentity = resolve(mate.worktree_path, 'crew-identity.json');
        if (existsSync(wtIdentity)) rmSync(wtIdentity);
      }
    }
    const rootIdentity = resolve(projectRoot, 'crew-identity.json');
    if (existsSync(rootIdentity)) rmSync(rootIdentity);

    // FLIPPED: cleanup by default unless --keep-worktrees is passed
    if (!keepWorktrees) {
      for (const [name, mate] of Object.entries(state.teammates || {})) {
        if (mate.worktree_path && existsSync(mate.worktree_path)) {
          console.log(`  Removing worktree: ${mate.worktree_path}`);
          try {
            execSync(`git worktree remove "${mate.worktree_path}" --force`, {
              cwd: projectRoot, stdio: 'pipe'
            });
          } catch (err) {
            console.warn(`  Warning: Could not remove worktree for ${name}: ${err.message}`);
          }
        }
      }
      console.log('Worktrees cleaned up.');
    } else {
      console.log('Worktrees preserved (--keep-worktrees).');
    }
  }
}

async function crewGc() {
  const { findOrphans, cleanup } = await import(
    join(PKG_ROOT, 'crew', 'lib', 'worktree-gc.js')
  );

  const deleteBranches = process.argv.includes('--branches');
  const force = process.argv.includes('--force');

  console.log('Scanning for orphaned worktrees...');
  console.log('');

  const orphans = findOrphans();

  if (orphans.length === 0) {
    console.log('✓ No orphaned worktrees found.');
    return;
  }

  console.log(`Found ${orphans.length} orphaned worktree${orphans.length > 1 ? 's' : ''}:`);
  console.log('');

  // Display table
  console.log('─'.repeat(120));
  console.log(
    '  Worktree Path'.padEnd(50) +
    'Branch'.padEnd(30) +
    'Reason'.padEnd(20) +
    'Age'.padEnd(10) +
    'Size'
  );
  console.log('─'.repeat(120));

  for (const orphan of orphans) {
    const reasonText = {
      'directory-missing': 'dir deleted',
      'team-stopped': 'team stopped',
      'teammate-stopped': 'mate stopped',
      'stale': 'stale'
    }[orphan.reason] || orphan.reason;

    const ageDaysText = orphan.ageDays === 'unknown' ? 'unknown' : `${orphan.ageDays}d`;
    const sizeText = orphan.diskSize || (orphan.exists ? '?' : 'N/A');

    // Truncate path if too long
    const pathDisplay = orphan.path.length > 48 ?
      '...' + orphan.path.slice(-45) :
      orphan.path;

    console.log(
      `  ${pathDisplay.padEnd(48)}${orphan.branch.padEnd(30)}${reasonText.padEnd(20)}${ageDaysText.padEnd(10)}${sizeText}`
    );
  }

  console.log('─'.repeat(120));
  console.log('');

  // Show what will be deleted
  const existingOrphans = orphans.filter(o => o.exists);
  console.log(`Will remove ${existingOrphans.length} worktree${existingOrphans.length !== 1 ? 's' : ''}.`);
  if (deleteBranches) {
    console.log('Will also delete associated git branches (--branches flag).');
  }
  console.log('');

  // Confirmation prompt
  if (!force) {
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const answer = await new Promise(resolve => {
      rl.question('Proceed with cleanup? (yes/no): ', resolve);
    });
    rl.close();

    if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
      console.log('Cleanup cancelled.');
      return;
    }
    console.log('');
  }

  // Execute cleanup
  console.log('Cleaning up...');
  console.log('');

  const results = cleanup(orphans, { deleteBranches, force: true });

  // Display results
  console.log('─'.repeat(80));
  console.log('Cleanup Results:');
  console.log('─'.repeat(80));
  console.log('');

  if (results.removed > 0) {
    console.log(`✓ Removed ${results.removed} worktree${results.removed !== 1 ? 's' : ''}`);
  }

  if (results.branchesDeleted > 0) {
    console.log(`✓ Deleted ${results.branchesDeleted} branch${results.branchesDeleted !== 1 ? 'es' : ''}`);
  }

  if (results.failed.length > 0) {
    console.log('');
    console.log(`✗ Failed to remove ${results.failed.length} worktree${results.failed.length !== 1 ? 's' : ''}:`);
    for (const failed of results.failed) {
      console.log(`  ${failed.name} (${failed.branch}): ${failed.error}`);
    }
  }

  console.log('');
  console.log('Done.');
}

async function crewStatus() {
  const { loadTeamState, listProfiles } = await import(
    join(PKG_ROOT, 'crew', 'lib', 'team-state-manager.js')
  );
  const { getProjectHash } = await import(
    join(PKG_ROOT, 'hooks', 'lib', 'crew-detect.js')
  );

  const projectHash = getProjectHash();
  const profileArg = process.argv.slice(4).find(a => !a.startsWith('--'));

  // Determine which profiles to show
  let profilesToShow;
  if (profileArg) {
    profilesToShow = [profileArg];
  } else {
    // Show all profiles that have state
    profilesToShow = listProfiles(projectHash);
    if (profilesToShow.length === 0) {
      console.log('No team state found. Run "cck crew start" first.');
      return;
    }
  }

  for (let idx = 0; idx < profilesToShow.length; idx++) {
    const pName = profilesToShow[idx];
    const state = loadTeamState(projectHash, pName);

    if (!state) {
      console.log(`No team state found for profile "${pName}".`);
      continue;
    }

    if (idx > 0) console.log('');

    const ageHours = Math.round((Date.now() - new Date(state.updated_at).getTime()) / 3600000);

    console.log(`Profile: ${pName}`);
    console.log(`Team: ${state.team_name}`);
    console.log(`Status: ${state.status} (updated ${ageHours}h ago)`);
    console.log(`Config hash: ${state.config_hash}`);
    console.log('─'.repeat(60));
    console.log('  Name'.padEnd(22) + 'Status'.padEnd(12) + 'Branch'.padEnd(30) + 'Agent ID');
    console.log('─'.repeat(60));

    for (const [name, mate] of Object.entries(state.teammates || {})) {
      const agentId = mate.agent_id ? mate.agent_id.slice(0, 12) + '...' : 'none';
      console.log(
        `  ${name.padEnd(20)}${(mate.status || 'unknown').padEnd(12)}${(mate.branch || '').padEnd(30)}${agentId}`
      );
    }
  }
}

async function crewMergePreview() {
  const { loadCrewConfig, resolveProfile, resolveTeammates } = await import(
    join(PKG_ROOT, 'crew', 'lib', 'crew-config-reader.js')
  );
  const { loadTeamState } = await import(
    join(PKG_ROOT, 'crew', 'lib', 'team-state-manager.js')
  );
  const { getProjectHash } = await import(
    join(PKG_ROOT, 'hooks', 'lib', 'crew-detect.js')
  );
  const { mergePreview, detectOverlaps } = await import(
    join(PKG_ROOT, 'crew', 'lib', 'merge-pilot.js')
  );

  const projectRoot = process.cwd();
  const projectHash = getProjectHash();
  const crewFilter = parseCrewFilter();
  const profileArg = process.argv.slice(4).find(a => !a.startsWith('--') && a !== crewFilter);

  // Load config to get main branch
  let config;
  try {
    config = loadCrewConfig(projectRoot);
  } catch (err) {
    console.error('Failed to load .crew-config.json:', err.message);
    console.error('Run "cck crew init" first.');
    process.exit(1);
  }

  // Resolve profile
  let profile, profileName;
  try {
    ({ profile, profileName } = resolveProfile(config, profileArg));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const mainBranch = config.project?.main_branch || 'main';

  // Load team state to get branches
  const state = loadTeamState(projectHash, profileName);
  if (!state || !state.teammates) {
    console.log(`No team state found for profile "${profileName}".`);
    console.log('Run "cck crew start" first.');
    return;
  }

  // Build teammates array from state, optionally filtered by crew
  const crewNames = crewFilter
    ? new Set(resolveTeammates(profile, crewFilter).map(t => t.name))
    : null;
  const teammates = Object.entries(state.teammates)
    .filter(([name]) => !crewNames || crewNames.has(name))
    .map(([name, mate]) => ({
      name,
      branch: mate.branch,
      worktree_path: mate.worktree_path
    }));

  if (teammates.length === 0) {
    console.log(crewFilter
      ? `No teammates found in crew "${crewFilter}".`
      : 'No teammates found in team state.');
    return;
  }

  const crewLabel = crewFilter ? ` [crew: ${crewFilter}]` : '';
  console.log(`Merge Preview: ${state.team_name} (profile: ${profileName})${crewLabel}`);
  console.log(`Main branch: ${mainBranch}`);
  console.log('─'.repeat(80));
  console.log('');

  // Run merge preview
  const results = mergePreview(projectRoot, mainBranch, teammates);

  // Display results as table
  console.log('Branch Merge Status:');
  console.log('─'.repeat(80));
  console.log(
    '  Teammate'.padEnd(20) +
    'Branch'.padEnd(30) +
    'Status'.padEnd(12) +
    'Conflicts'.padEnd(10) +
    'Changed'
  );
  console.log('─'.repeat(80));

  for (const result of results) {
    const statusIcon = result.status === 'clean' ? '✓' : result.status === 'conflict' ? '✗' : '⚠';
    const statusColor = result.status === 'clean' ? result.status : result.status;
    console.log(
      `  ${result.name.padEnd(18)}${result.branch.padEnd(30)}${(statusIcon + ' ' + statusColor).padEnd(12)}${result.conflictFiles.length.toString().padEnd(10)}${result.changedFiles.length}`
    );
    if (result.message) {
      console.log(`    → ${result.message}`);
    }
  }

  console.log('');

  // Show overlapping changes
  const overlaps = detectOverlaps(projectRoot, mainBranch, teammates);
  if (overlaps.length > 0) {
    console.log('Overlapping File Changes:');
    console.log('─'.repeat(80));
    for (const overlap of overlaps) {
      console.log(`  ${overlap.teammates[0]} ↔ ${overlap.teammates[1]}`);
      console.log(`    Files: ${overlap.files.join(', ')}`);
    }
    console.log('');
  }

  // Summary
  const cleanCount = results.filter(r => r.status === 'clean').length;
  const conflictCount = results.filter(r => r.status === 'conflict').length;
  const errorCount = results.filter(r => r.status === 'error').length;

  console.log('Summary:');
  console.log(`  ✓ ${cleanCount} clean merges`);
  if (conflictCount > 0) console.log(`  ✗ ${conflictCount} with conflicts`);
  if (errorCount > 0) console.log(`  ⚠ ${errorCount} errors`);
  console.log('');

  if (conflictCount > 0 || errorCount > 0) {
    console.log('To merge: cck crew merge [profile]');
    console.log('Note: Conflicting branches will require manual resolution.');
  } else {
    console.log('All branches can be merged cleanly!');
    console.log('To proceed: cck crew merge [profile]');
  }
}

async function crewMerge() {
  const { loadCrewConfig, resolveProfile, resolveTeammates } = await import(
    join(PKG_ROOT, 'crew', 'lib', 'crew-config-reader.js')
  );
  const { loadTeamState } = await import(
    join(PKG_ROOT, 'crew', 'lib', 'team-state-manager.js')
  );
  const { getProjectHash } = await import(
    join(PKG_ROOT, 'hooks', 'lib', 'crew-detect.js')
  );
  const { mergePreview, executeMerge } = await import(
    join(PKG_ROOT, 'crew', 'lib', 'merge-pilot.js')
  );

  const projectRoot = process.cwd();
  const projectHash = getProjectHash();
  const crewFilter = parseCrewFilter();
  const profileArg = process.argv.slice(4).find(a => !a.startsWith('--') && a !== crewFilter);
  const runTests = process.argv.includes('--test');
  const testCommand = process.argv.find(a => a.startsWith('--test-command='))?.split('=')[1] || 'npm test';

  // Load config
  let config;
  try {
    config = loadCrewConfig(projectRoot);
  } catch (err) {
    console.error('Failed to load .crew-config.json:', err.message);
    process.exit(1);
  }

  // Resolve profile
  let profile, profileName;
  try {
    ({ profile, profileName } = resolveProfile(config, profileArg));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const mainBranch = config.project?.main_branch || 'main';

  // Load team state
  const state = loadTeamState(projectHash, profileName);
  if (!state || !state.teammates) {
    console.log(`No team state found for profile "${profileName}".`);
    process.exit(1);
  }

  // Build teammates array, optionally filtered by crew
  const crewNames = crewFilter
    ? new Set(resolveTeammates(profile, crewFilter).map(t => t.name))
    : null;
  const teammates = Object.entries(state.teammates)
    .filter(([name]) => !crewNames || crewNames.has(name))
    .map(([name, mate]) => ({
      name,
      branch: mate.branch
    }));

  if (teammates.length === 0) {
    console.log(crewFilter
      ? `No teammates found in crew "${crewFilter}".`
      : 'No teammates found.');
    return;
  }

  const crewLabel = crewFilter ? ` [crew: ${crewFilter}]` : '';
  console.log(`Crew Merge: ${state.team_name} (profile: ${profileName})${crewLabel}`);
  console.log(`Main branch: ${mainBranch}`);
  console.log('─'.repeat(80));
  console.log('');

  // Show preview first
  console.log('Running merge preview...');
  const preview = mergePreview(projectRoot, mainBranch, teammates);

  console.log('');
  console.log('Preview Results:');
  for (const result of preview) {
    const status = result.status === 'clean' ? '✓ clean' : result.status === 'conflict' ? '✗ conflicts' : '⚠ error';
    console.log(`  ${result.name.padEnd(20)} ${result.branch.padEnd(30)} ${status}`);
    if (result.conflictFiles.length > 0) {
      console.log(`    Conflicts in: ${result.conflictFiles.slice(0, 3).join(', ')}${result.conflictFiles.length > 3 ? '...' : ''}`);
    }
  }
  console.log('');

  // Confirmation prompt
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const answer = await new Promise(resolve => {
    rl.question('Proceed with merge? (yes/no): ', resolve);
  });
  rl.close();

  if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
    console.log('Merge cancelled.');
    return;
  }

  console.log('');
  console.log('Executing merges...');
  console.log('');

  // Execute merge
  const results = executeMerge(projectRoot, mainBranch, teammates, {
    runTests,
    testCommand
  });

  // Display results
  console.log('─'.repeat(80));
  console.log('Merge Results:');
  console.log('─'.repeat(80));
  console.log('');

  if (results.success.length > 0) {
    console.log('✓ Successful merges:');
    for (const s of results.success) {
      console.log(`  ${s.name.padEnd(20)} ${s.branch}`);
      if (s.testResult) {
        console.log(`    Tests: ${s.testResult}`);
      }
    }
    console.log('');
  }

  if (results.failed.length > 0) {
    console.log('✗ Failed merges:');
    for (const f of results.failed) {
      console.log(`  ${f.name.padEnd(20)} ${f.branch}`);
      console.log(`    Reason: ${f.reason}`);
      if (f.message) {
        console.log(`    ${f.message}`);
      }
    }
    console.log('');
  }

  if (results.skipped.length > 0) {
    console.log('⚠ Skipped:');
    for (const s of results.skipped) {
      console.log(`  ${s.name.padEnd(20)} ${s.branch}`);
      console.log(`    ${s.reason}`);
    }
    console.log('');
  }

  if (results.backup_tag) {
    console.log(`Backup tag created: ${results.backup_tag}`);
    console.log(`To rollback: git reset --hard ${results.backup_tag}`);
    console.log('');
  }

  console.log('Summary:');
  console.log(`  ✓ ${results.success.length} merged`);
  console.log(`  ✗ ${results.failed.length} failed`);
  console.log(`  ⚠ ${results.skipped.length} skipped`);
}

async function crewDecompose() {
  const { decompose, generateCrewConfig } = await import(
    join(PKG_ROOT, 'crew', 'lib', 'task-decomposer.js')
  );

  const projectRoot = process.cwd();
  const write = process.argv.includes('--write');

  // Get entry paths (all args after "crew decompose" that aren't flags)
  const entryPaths = process.argv.slice(4).filter(a => !a.startsWith('--'));

  // Parse --teammates flag
  let maxTeammates = null;
  const teammatesIdx = process.argv.indexOf('--teammates');
  if (teammatesIdx !== -1 && process.argv[teammatesIdx + 1]) {
    maxTeammates = parseInt(process.argv[teammatesIdx + 1]);
    if (isNaN(maxTeammates) || maxTeammates < 1) {
      console.error('Error: --teammates must be a positive integer');
      process.exit(1);
    }
  }

  const graphFile = join(process.env.HOME, '.claude', 'dep-graph.toon');
  if (!existsSync(graphFile)) {
    console.error('Error: Dependency graph not found.');
    console.error('Run the dependency scanner first:');
    console.error('  $HOME/.claude/bin/dependency-scanner');
    process.exit(1);
  }

  console.log('Analyzing dependency graph...');
  console.log('');

  let result;
  try {
    result = decompose(projectRoot, entryPaths, { maxTeammates });
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  const { clusters, metadata } = result;

  console.log(`Found ${metadata.totalFiles} files in ${metadata.totalClusters} independent clusters:`);
  console.log('');

  // Display clusters
  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    console.log(`Cluster ${i + 1}: ${cluster.name}`);
    console.log(`  Branch: ${cluster.suggestedBranch}`);
    console.log(`  Files: ${cluster.files.length}`);
    console.log(`  Focus: ${cluster.suggestedFocus}`);
    console.log('');
  }

  // Generate crew config
  const crewConfig = generateCrewConfig(clusters);

  console.log('Suggested crew config:');
  console.log('─'.repeat(60));
  console.log(JSON.stringify(crewConfig, null, 2));
  console.log('─'.repeat(60));
  console.log('');

  if (write) {
    const dest = resolve(projectRoot, '.crew-config.json');
    if (existsSync(dest)) {
      console.error('Error: .crew-config.json already exists.');
      console.error('Remove it first or omit --write to preview only.');
      process.exit(1);
    }

    writeFileSync(dest, JSON.stringify(crewConfig, null, 2) + '\n');
    console.log(`Written to: ${dest}`);
    console.log('');
    console.log('Next steps:');
    console.log('  1. Review and edit .crew-config.json as needed');
    console.log('  2. Run: cck crew start');
  } else {
    console.log('To write this config:');
    console.log('  cck crew decompose --write');
  }
}

async function crewDoctor() {
  const { loadCrewConfig, resolveProfile, resolveTeammates } = await import(
    join(PKG_ROOT, 'crew', 'lib', 'crew-config-reader.js')
  );
  const { loadTeamState } = await import(
    join(PKG_ROOT, 'crew', 'lib', 'team-state-manager.js')
  );
  const { getProjectHash } = await import(
    join(PKG_ROOT, 'hooks', 'lib', 'crew-detect.js')
  );
  const { checkHealth, formatHealthReport } = await import(
    join(PKG_ROOT, 'crew', 'lib', 'health-monitor.js')
  );

  const projectRoot = process.cwd();
  const projectHash = getProjectHash();
  const crewFilter = parseCrewFilter();
  const profileArg = process.argv.slice(4).find(a => !a.startsWith('--') && a !== crewFilter);

  // Determine profile to check
  let profile, profileName = 'default';
  if (profileArg) {
    profileName = profileArg;
  }
  try {
    const config = loadCrewConfig(projectRoot);
    const resolved = resolveProfile(config, profileArg || undefined);
    profile = resolved.profile;
    profileName = resolved.profileName;
  } catch {
    // Use default
  }

  const state = loadTeamState(projectHash, profileName);
  if (!state || !state.teammates) {
    console.log(`No team state found for profile "${profileName}".`);
    console.log('Run "cck crew start" first.');
    return;
  }

  const crewLabel = crewFilter ? ` [crew: ${crewFilter}]` : '';
  console.log(`Crew Health Check: ${state.team_name} (profile: ${profileName})${crewLabel}`);
  console.log('');

  // Run health check
  let healthReports = checkHealth(projectHash, profileName, {
    staleThresholdMinutes: 10,
    commitWindowMinutes: 30
  });

  // Filter by crew if requested
  if (crewFilter && profile) {
    const crewNames = new Set(resolveTeammates(profile, crewFilter).map(t => t.name));
    healthReports = healthReports.filter(r => crewNames.has(r.name));
  }

  // Display formatted report
  console.log(formatHealthReport(healthReports));
  console.log('');

  // Summary
  const healthCounts = healthReports.reduce((acc, r) => {
    acc[r.health] = (acc[r.health] || 0) + 1;
    return acc;
  }, {});

  console.log('Summary:');
  if (healthCounts.active) console.log(`  ✓ ${healthCounts.active} active`);
  if (healthCounts.idle) console.log(`  ○ ${healthCounts.idle} idle`);
  if (healthCounts.unresponsive) console.log(`  ⚠ ${healthCounts.unresponsive} unresponsive`);
  if (healthCounts.crashed) console.log(`  ✗ ${healthCounts.crashed} crashed`);
  console.log('');

  // Exit code: 0 if all healthy, 1 if any unhealthy
  const hasUnhealthy = (healthCounts.crashed || 0) + (healthCounts.unresponsive || 0) > 0;
  if (hasUnhealthy) {
    console.log('⚠ Some teammates need attention. See recovery steps above.');
    process.exit(1);
  } else {
    console.log('✓ All teammates are healthy.');
  }
}

async function crewDiscoveries() {
  if (!existsSync(CAPSULE_DB_PATH)) {
    console.log('No capsule.db found. Discoveries will be available after your first crew session.');
    return;
  }

  const { Blink } = await import('blink-query');
  const { getProjectHash, crewNamespace } = await import(
    join(PKG_ROOT, 'hooks', 'lib', 'crew-detect.js')
  );

  const projectRoot = process.cwd();
  const crewFilter = parseCrewFilter();
  const limit = parseInt(process.argv.slice(4).find(a => !a.startsWith('--') && a !== crewFilter)) || 20;
  const projectHash = getProjectHash();

  // Resolve crew member names for filtering
  let crewNames = null;
  if (crewFilter) {
    try {
      const { loadCrewConfig, resolveProfile, resolveTeammates } = await import(
        join(PKG_ROOT, 'crew', 'lib', 'crew-config-reader.js')
      );
      const config = loadCrewConfig(projectRoot);
      const { profile } = resolveProfile(config);
      crewNames = new Set(resolveTeammates(profile, crewFilter).map(t => t.name));
    } catch {
      // If config not available, skip filtering
    }
  }

  const blink = new Blink({ dbPath: CAPSULE_DB_PATH });

  try {
    // Query crew shared discoveries namespace
    const sharedNs = `proj/${projectHash}/crew/_shared/discoveries`;
    let discoveries = [];

    try {
      const result = blink.resolve(sharedNs);

      if (result?.record?.content && Array.isArray(result.record.content)) {
        // Resolve each child fully to get summary, source_teammate, timestamp
        for (const child of result.record.content) {
          try {
            const full = blink.resolve(child.path);
            if (full?.record) discoveries.push(full.record);
          } catch { /* skip unresolvable */ }
        }
      } else if (result?.record?.summary) {
        discoveries = [result.record];
      }
    } catch (err) {
      // Namespace doesn't exist yet
    }

    // Filter by crew if requested
    if (crewNames) {
      discoveries = discoveries.filter(d => {
        const teammate = d.content?.source_teammate;
        return teammate && crewNames.has(teammate);
      });
    }

    // Sort by timestamp descending
    discoveries.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    const toShow = discoveries.slice(0, limit);

    const crewLabel = crewFilter ? ` [crew: ${crewFilter}]` : '';
    console.log(`## Shared Team Discoveries (${toShow.length})${crewLabel}\n`);

    if (toShow.length === 0) {
      console.log('No team discoveries saved yet.');
      console.log('');
      console.log('Teammates can share discoveries:');
      console.log('  bash $HOME/.claude/cck/tools/context-query/context-query.sh save crew/_shared/discoveries "Title" "Summary"');
    } else {
      console.log('| Teammate | Title | Summary | Date |');
      console.log('|----------|-------|---------|------|');

      toShow.forEach(d => {
        const teammate = d.content?.source_teammate || 'unknown';
        const agent = d.content?.source_agent || '';
        const source = agent ? `${teammate} (${agent})` : teammate;
        const title = (d.title || '').replace(/\|/g, '\\|').slice(0, 40);
        const summary = (d.summary || '').replace(/\|/g, '\\|').slice(0, 60);
        const date = d.created_at ? new Date(d.created_at).toISOString().split('T')[0] : 'unknown';

        console.log(`| ${source.padEnd(20)} | ${title.padEnd(40)} | ${summary.padEnd(60)} | ${date} |`);
      });

      console.log('');
      console.log(`Showing ${toShow.length} of ${discoveries.length} total discoveries.`);
    }
  } finally {
    blink.close();
  }
}

async function crewActivity() {
  if (!existsSync(CAPSULE_DB_PATH)) {
    console.log('No capsule.db found. Activity will be available after your first crew session.');
    return;
  }

  const { getTeammateActivity, detectOverlaps } = await import(
    join(PKG_ROOT, 'crew', 'lib', 'activity-monitor.js')
  );
  const { getProjectHash } = await import(
    join(PKG_ROOT, 'hooks', 'lib', 'crew-detect.js')
  );

  const projectRoot = process.cwd();
  const projectHash = getProjectHash();
  const crewFilter = parseCrewFilter();
  const limit = parseInt(process.argv.slice(4).find(a => !a.startsWith('--') && a !== crewFilter)) || 10;

  const crewLabel = crewFilter ? ` [crew: ${crewFilter}]` : '';
  console.log(`## Crew Activity Monitor${crewLabel}\n`);

  // Get teammate activities
  let activities = getTeammateActivity(CAPSULE_DB_PATH, projectHash, { limit });

  // Filter by crew if requested
  if (crewFilter) {
    try {
      const { loadCrewConfig, resolveProfile, resolveTeammates } = await import(
        join(PKG_ROOT, 'crew', 'lib', 'crew-config-reader.js')
      );
      const config = loadCrewConfig(projectRoot);
      const { profile } = resolveProfile(config);
      const crewNames = new Set(resolveTeammates(profile, crewFilter).map(t => t.name));
      activities = activities.filter(a => crewNames.has(a.teammateName));
    } catch {
      // If config not available, skip filtering
    }
  }

  if (activities.length === 0) {
    console.log('No teammate activity found.');
    console.log('');
    console.log('Teammates will appear here after they start working.');
    return;
  }

  // Display per-teammate activity
  console.log('### Recent File Operations\n');

  for (const activity of activities) {
    const ageMs = Date.now() - activity.lastActive;
    const ageMinutes = Math.round(ageMs / 60000);
    const ageHours = Math.round(ageMs / 3600000);
    const ageDisplay = ageHours > 0 ? `${ageHours}h ago` : `${ageMinutes}m ago`;

    console.log(`**${activity.teammateName}** (last active ${ageDisplay})`);

    if (activity.recentOps.length === 0) {
      console.log('  No operations recorded yet.\n');
      continue;
    }

    for (const op of activity.recentOps) {
      const fileName = op.file.split('/').pop();
      const timeAgo = Math.round((Date.now() - op.timestamp) / 60000);
      console.log(`  - ${op.action}: ${fileName} (${timeAgo}m ago)`);
    }

    console.log('');
  }

  // Detect overlaps
  const overlaps = detectOverlaps(activities);

  if (overlaps.length > 0) {
    console.log('### ⚠️  Overlapping File Changes\n');

    for (const overlap of overlaps) {
      const fileName = overlap.file.split('/').pop();
      console.log(`**${fileName}**`);
      console.log(`  Touched by: ${overlap.teammates.join(', ')}`);
      console.log(`  File: ${overlap.file}\n`);
    }

    console.log(`\n${overlaps.length} file(s) with potential conflicts detected.`);
  } else {
    console.log('### ✓ No Overlaps\n');
    console.log('No files have been touched by multiple teammates.');
  }
}

async function prune() {
  if (!existsSync(CAPSULE_DB_PATH)) {
    console.log('No database found. Nothing to prune.');
    return;
  }

  const days = parseInt(process.argv[3]) || 30;
  const dryRun = process.argv.includes('--dry-run');
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();

  const { Blink } = await import('blink-query');
  const blink = new Blink({ dbPath: CAPSULE_DB_PATH });

  const stale = blink.db.prepare(
    'SELECT COUNT(*) as count FROM records WHERE updated_at < ?'
  ).get(cutoff);

  if (stale.count === 0) {
    console.log(`No records older than ${days} days.`);
    blink.close();
    return;
  }

  if (dryRun) {
    console.log(`Would prune ${stale.count} records older than ${days} days.`);
    blink.close();
    return;
  }

  const result = blink.db.prepare(
    'DELETE FROM records WHERE updated_at < ?'
  ).run(cutoff);

  console.log(`Pruned ${result.changes} records older than ${days} days.`);
  blink.close();
}

async function stats() {
  const statsToolPath = join(CCK_DIR, 'tools', 'stats', 'stats.js');

  if (!existsSync(statsToolPath)) {
    console.error('Stats tool not found. Run "cck setup" first.');
    process.exit(1);
  }

  // Pass all args after "stats" to the tool
  const args = process.argv.slice(3);

  try {
    execSync(`node "${statsToolPath}" ${args.join(' ')}`, {
      stdio: 'inherit',
      cwd: process.cwd()
    });
  } catch (err) {
    process.exit(err.status || 1);
  }
}

async function map() {
  const sub = process.argv[3];
  const subs = { init: mapInit, status: mapStatus, show: mapShow, update: mapUpdate, hot: mapHot, stubs: mapStubs };

  if (!sub || !subs[sub]) {
    console.log('Usage: cck map <command>');
    console.log('');
    console.log('Commands:');
    console.log('  cck map init              Scan codebase and build map');
    console.log('  cck map status            Show map status and coverage');
    console.log('  cck map show <path>       Show file or directory details');
    console.log('  cck map update            Incremental update (changed files only)');
    console.log('  cck map hot               Show hub files (most imported)');
    console.log('  cck map stubs             Show files with no understanding');
    process.exit(sub ? 1 : 0);
  }
  await subs[sub]();
}

async function mapInit() {
  const scannerPath = join(PKG_ROOT, 'tools', 'map-scanner', 'map-scanner.js');
  const linkerPath = join(PKG_ROOT, 'tools', 'map-scanner', 'dep-linker.js');

  if (!existsSync(scannerPath)) {
    console.error('Map scanner not found. Run "cck setup" to install or check tools/map-scanner/map-scanner.js');
    process.exit(1);
  }
  if (!existsSync(linkerPath)) {
    console.error('Dep linker not found. Run "cck setup" to install or check tools/map-scanner/dep-linker.js');
    process.exit(1);
  }

  console.log('Scanning codebase...');
  const { scanCodebase } = await import(scannerPath);
  await scanCodebase(process.cwd());

  console.log('Linking dependencies...');
  const { linkDependencies, computeProjectHash } = await import(linkerPath);
  await linkDependencies(process.cwd(), computeProjectHash(process.cwd()));

  console.log('Map built successfully. Run "cck map status" to see coverage.');
}

async function mapStatus() {
  const { Blink } = await import(join(CCK_DIR, 'node_modules', 'blink-query', 'dist', 'blink.js'));
  const { getProjectHash, getCapsuleDbPath } = await import(join(CCK_DIR, 'hooks', 'lib', 'crew-detect.js'));

  const dbPath = getCapsuleDbPath();
  if (!existsSync(dbPath)) {
    console.log('No map found. Run "cck map init" first.');
    return;
  }

  const blink = new Blink({ dbPath });
  const hash = getProjectHash();
  const ns = `map/${hash}/meta`;

  const metaRecords = blink.list(ns);
  const meta = metaRecords[0];
  if (!meta) {
    console.log('No map found. Run "cck map init" first.');
    blink.close();
    return;
  }

  let data = {};
  try { data = JSON.parse(meta.content || '{}'); } catch {}

  console.log('Codebase Map Status');
  console.log('─'.repeat(40));
  console.log(`  Files scanned:  ${data.file_count ?? 'unknown'}`);
  console.log(`  Languages:      ${Array.isArray(data.languages) ? data.languages.join(', ') : (data.languages ?? 'unknown')}`);
  console.log(`  Last scan SHA:  ${data.last_scan_sha ?? 'unknown'}`);

  try {
    const headSha = execSync('git rev-parse --short HEAD', { stdio: 'pipe' }).toString().trim();
    const stale = data.last_scan_sha && data.last_scan_sha !== headSha;
    console.log(`  Current HEAD:   ${headSha}${stale ? ' (map is stale — run "cck map update")' : ' (up to date)'}`);
  } catch {}

  blink.close();
}

async function mapShow() {
  const targetPath = process.argv[4];
  if (!targetPath) {
    console.error('Usage: cck map show <path>');
    process.exit(1);
  }

  const { Blink } = await import(join(CCK_DIR, 'node_modules', 'blink-query', 'dist', 'blink.js'));
  const { getProjectHash, getCapsuleDbPath } = await import(join(CCK_DIR, 'hooks', 'lib', 'crew-detect.js'));

  const dbPath = getCapsuleDbPath();
  if (!existsSync(dbPath)) {
    console.log('No map found. Run "cck map init" first.');
    return;
  }

  const blink = new Blink({ dbPath });
  const hash = getProjectHash();
  const ns = `map/${hash}/ast/${targetPath}`;

  const records = blink.list(ns);
  const record = records[0];
  if (!record) {
    console.log(`No map record found for: ${targetPath}`);
    console.log('Run "cck map init" to build the map.');
    blink.close();
    return;
  }

  let data = {};
  try { data = JSON.parse(record.content || '{}'); } catch {}

  if (record.type === 'COLLECTION') {
    console.log(`Directory: ${targetPath}`);
    console.log('─'.repeat(40));
    const children = blink.list(ns);
    for (const child of children) {
      console.log(`  ${child.namespace.replace(ns + '/', '')}`);
    }
  } else {
    console.log(`File: ${targetPath}`);
    console.log('─'.repeat(40));
    console.log(`  Role:        ${data.role ?? 'unknown'}`);
    console.log(`  Exports:     ${Array.isArray(data.exports) ? data.exports.join(', ') : 'none'}`);
    console.log(`  Imports:     ${Array.isArray(data.imports) ? data.imports.join(', ') : 'none'}`);
    console.log(`  Imported by: ${Array.isArray(data.imported_by) ? data.imported_by.join(', ') : 'none'}`);
    if (data.understanding_depth) {
      console.log(`  Understanding: ${data.understanding_depth}`);
    }
  }

  blink.close();
}

async function mapUpdate() {
  const { Blink } = await import(join(CCK_DIR, 'node_modules', 'blink-query', 'dist', 'blink.js'));
  const { getProjectHash, getCapsuleDbPath } = await import(join(CCK_DIR, 'hooks', 'lib', 'crew-detect.js'));

  const dbPath = getCapsuleDbPath();
  if (!existsSync(dbPath)) {
    console.log('No map found. Run "cck map init" first.');
    return;
  }

  const blink = new Blink({ dbPath });
  const hash = getProjectHash();
  const metaRecords2 = blink.list(`map/${hash}/meta`);
  const meta2 = metaRecords2[0];
  if (!meta) {
    console.log('No map found. Run "cck map init" first.');
    blink.close();
    return;
  }

  let data = {};
  try { data = JSON.parse(meta.content || '{}'); } catch {}
  const storedSha = data.last_scan_sha;
  blink.close();

  if (!storedSha) {
    console.log('No stored SHA found. Running full scan...');
    await mapInit();
    return;
  }

  let changedFiles = [];
  try {
    const diff = execSync(`git diff ${storedSha}..HEAD --name-only`, { stdio: 'pipe' }).toString().trim();
    changedFiles = diff ? diff.split('\n').filter(Boolean) : [];
  } catch (err) {
    console.error(`Failed to get git diff: ${err.message}`);
    process.exit(1);
  }

  if (changedFiles.length === 0) {
    console.log('No changed files since last scan. Map is up to date.');
    return;
  }

  console.log(`Re-scanning ${changedFiles.length} changed file(s)...`);

  const scannerPath = join(PKG_ROOT, 'tools', 'map-scanner', 'map-scanner.js');
  if (!existsSync(scannerPath)) {
    console.error('Map scanner not found. Run "cck setup" first.');
    process.exit(1);
  }

  const { scanCodebase } = await import(scannerPath);
  await scanCodebase({ files: changedFiles });

  const linkerPath = join(PKG_ROOT, 'tools', 'map-scanner', 'dep-linker.js');
  if (existsSync(linkerPath)) {
    const { linkDependencies } = await import(linkerPath);
    await linkDependencies();
  }

  console.log(`Updated ${changedFiles.length} file(s). Run "cck map status" to confirm.`);
}

async function mapHot() {
  const { Blink } = await import(join(CCK_DIR, 'node_modules', 'blink-query', 'dist', 'blink.js'));
  const { getProjectHash, getCapsuleDbPath } = await import(join(CCK_DIR, 'hooks', 'lib', 'crew-detect.js'));

  const dbPath = getCapsuleDbPath();
  if (!existsSync(dbPath)) {
    console.log('No map found. Run "cck map init" first.');
    return;
  }

  const blink = new Blink({ dbPath });
  const hash = getProjectHash();
  const ns = `map/${hash}/ast`;

  const records = blink.list(ns);
  if (!records || records.length === 0) {
    console.log('No map records found. Run "cck map init" first.');
    blink.close();
    return;
  }

  const fileScores = [];
  for (const record of records) {
    let data = {};
    try { data = JSON.parse(record.content || '{}'); } catch {}
    if (Array.isArray(data.imported_by) && data.imported_by.length > 0) {
      const filePath = record.namespace.replace(`${ns}/`, '');
      fileScores.push({ path: filePath, importedBy: data.imported_by.length });
    }
  }

  fileScores.sort((a, b) => b.importedBy - a.importedBy);
  const top = fileScores.slice(0, 10);

  if (top.length === 0) {
    console.log('No hub files found (no files with importers tracked yet).');
  } else {
    console.log('Hub Files (most imported):');
    console.log('─'.repeat(40));
    for (const { path, importedBy } of top) {
      console.log(`  ${String(importedBy).padStart(3)} importers  ${path}`);
    }
  }

  blink.close();
}

async function mapStubs() {
  const { Blink } = await import(join(CCK_DIR, 'node_modules', 'blink-query', 'dist', 'blink.js'));
  const { getProjectHash, getCapsuleDbPath } = await import(join(CCK_DIR, 'hooks', 'lib', 'crew-detect.js'));

  const dbPath = getCapsuleDbPath();
  if (!existsSync(dbPath)) {
    console.log('No map found. Run "cck map init" first.');
    return;
  }

  const blink = new Blink({ dbPath });
  const hash = getProjectHash();
  const ns = `map/${hash}/ast`;

  const records = blink.list(ns);
  if (!records || records.length === 0) {
    console.log('No map records found. Run "cck map init" first.');
    blink.close();
    return;
  }

  const stubs = [];
  for (const record of records) {
    let data = {};
    try { data = JSON.parse(record.content || '{}'); } catch {}
    if (data.understanding_depth === 'stub') {
      stubs.push(record.namespace.replace(`${ns}/`, ''));
    }
  }

  if (stubs.length === 0) {
    console.log('No stub files found. All files have some understanding depth.');
  } else {
    console.log(`Stub Files (${stubs.length} files with no understanding):`);
    console.log('─'.repeat(40));
    for (const path of stubs) {
      console.log(`  ${path}`);
    }
  }

  blink.close();
}
