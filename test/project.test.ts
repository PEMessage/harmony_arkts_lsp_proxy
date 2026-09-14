import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { parseProject, extractCompatibleSdkLevel, findProjectRoot, type AceModule } from '../src/project';

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'sample-project');

describe('extractCompatibleSdkLevel', () => {
  it('extracts level from "5.0.0(12)"', () => {
    expect(extractCompatibleSdkLevel('5.0.0(12)')).toBe('12');
  });

  it('extracts level from "4.1.0(11)"', () => {
    expect(extractCompatibleSdkLevel('4.1.0(11)')).toBe('11');
  });

  it('returns "12" as fallback for unrecognized format', () => {
    expect(extractCompatibleSdkLevel('unknown')).toBe('12');
  });
});

describe('parseProject', () => {
  const mockSdkPath = '/mock/sdk/default';

  it('returns null when build-profile.json5 is missing', () => {
    expect(parseProject('/nonexistent', mockSdkPath)).toBeNull();
  });

  it('parses modules from build-profile.json5', () => {
    const result = parseProject(FIXTURE_DIR, mockSdkPath);
    expect(result).not.toBeNull();
    expect(result!.projectRoot).toBe(FIXTURE_DIR);
    expect(result!.modules).toHaveLength(1);
  });

  it('constructs AceModule with correct fields', () => {
    const result = parseProject(FIXTURE_DIR, mockSdkPath);
    const mod = result!.modules[0];

    expect(mod.moduleName).toBe('entry');
    expect(mod.modulePath).toBe(path.join(FIXTURE_DIR, 'entry'));
    expect(mod.deviceType).toEqual([5]);
    expect(mod.jsComponentType).toBe('declarative');
    expect(mod.compatibleSdkLevel).toBe('12');
    expect(mod.apiType).toBe('stageMode');
    expect(mod.sdkJsPath).toContain('js/api/phone');
    expect(mod.aceLoaderPath).toContain('js/framework/phone/ace-loader');
  });

  it('uses rootUri format correctly', () => {
    const result = parseProject(FIXTURE_DIR, mockSdkPath);
    expect(result!.rootUri).toBe('file://' + FIXTURE_DIR);
  });
});

describe('findProjectRoot', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'findroot-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds project root in current directory', () => {
    fs.writeFileSync(path.join(tmpDir, 'build-profile.json5'), '{}');
    expect(findProjectRoot(tmpDir)).toBe(tmpDir);
  });

  it('finds project root in parent directory', () => {
    const sub = path.join(tmpDir, 'entry', 'src');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'build-profile.json5'), '{}');
    expect(findProjectRoot(sub)).toBe(tmpDir);
  });

  it('returns null when no build-profile.json5 found', () => {
    expect(findProjectRoot(tmpDir)).toBeNull();
  });
});

const TABLET_FIXTURE_DIR = path.join(__dirname, 'fixtures', 'tablet-project');

describe('deviceType derivation', () => {
  const mockSdkPath = '/mock/sdk/default';

  it('derives deviceType from compatibleDeviceType', () => {
    const result = parseProject(TABLET_FIXTURE_DIR, mockSdkPath);
    expect(result).not.toBeNull();
    expect(result!.modules[0].deviceType).toEqual([7]);
  });

  it('defaults to ["phone"] when compatibleDeviceType is missing', () => {
    const result = parseProject(FIXTURE_DIR, mockSdkPath);
    expect(result).not.toBeNull();
    expect(result!.modules[0].deviceType).toEqual([5]);
  });
});

describe('SDK layout detection and targetSdkVersion', () => {
  let tmpDir: string;
  let sdkDefault: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkts-sdk-'));
    sdkDefault = path.join(tmpDir, 'sdk', 'default');
    // HarmonyOS 26 layout: everything nested under openharmony/.
    fs.mkdirSync(path.join(sdkDefault, 'openharmony', 'js', 'api'), { recursive: true });
    fs.mkdirSync(path.join(sdkDefault, 'openharmony', 'js', 'build-tools', 'ace-loader'), { recursive: true });
    fs.mkdirSync(path.join(sdkDefault, 'openharmony', 'ets', 'api'), { recursive: true });
    fs.mkdirSync(path.join(sdkDefault, 'openharmony', 'ets', 'kits'), { recursive: true });

    fs.mkdirSync(path.join(tmpDir, 'entry'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'entry', 'module.json5'),
      "{ module: { name: 'entry', type: 'entry', deviceTypes: ['phone'] } }",
    );
    // Only targetSdkVersion (the newer field); no compileSdkVersion/targetAPIVersion.
    fs.writeFileSync(
      path.join(tmpDir, 'build-profile.json5'),
      `{
  app: { products: [ { name: 'default', compatibleSdkVersion: '26.0.0', targetSdkVersion: '26.0.0' } ] },
  modules: [ { name: 'entry', srcPath: './entry' } ]
}`,
    );
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('resolves the openharmony/ SDK layout', () => {
    const mod = parseProject(tmpDir, sdkDefault)!.modules[0];
    expect(mod.sdkJsPath).toBe(path.join(sdkDefault, 'openharmony', 'js', 'api') + path.sep);
    expect(mod.aceLoaderPath).toBe(path.join(sdkDefault, 'openharmony', 'js', 'build-tools', 'ace-loader'));
    expect(mod.sdkApiPath).toBe(path.join(sdkDefault, 'openharmony', 'ets', 'api') + path.sep);
    expect(mod.hosSdkPath).toBe(path.join(sdkDefault, 'openharmony') + path.sep);
  });

  it('falls back to the legacy js/api/<device> shape when nothing is found', () => {
    const mod = parseProject(tmpDir, '/mock/sdk/default')!.modules[0];
    expect(mod.sdkJsPath).toContain('js/api/phone');
    expect(mod.aceLoaderPath).toContain('js/framework/phone/ace-loader');
    expect(mod.sdkApiPath).toBeUndefined();
    expect(mod.hosSdkPath).toBeUndefined();
  });

  it('reads compileSdkVersion from targetSdkVersion instead of defaulting to 12', () => {
    const mod = parseProject(tmpDir, sdkDefault)!.modules[0];
    expect(mod.compatibleSdkVersion).toBe('26');
    expect(mod.compileSdkLevel).toBe('26');
    expect(mod.compileSdkVersion).toBe('26.0.0');
  });
});
