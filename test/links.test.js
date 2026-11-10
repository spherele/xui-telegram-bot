import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractSecrets } from '../src/links.js';

const UUID = 'a1b2c3d4-e5f6-4711-8899-aabbccddeeff';

test('ссылка подписки', () => {
  assert.deepEqual(extractSecrets('https://vpn.example.com:2096/sub/abc123xyz456'), ['abc123xyz456']);
  assert.deepEqual(extractSecrets('вот моя ссылка: https://x.io/json/qwertyuiop12 спасибо'), ['qwertyuiop12']);
});

test('vless / trojan / hysteria2', () => {
  assert.deepEqual(extractSecrets(`vless://${UUID}@1.2.3.4:443?type=tcp&security=reality#My%20VPN`), [UUID]);
  assert.deepEqual(extractSecrets('trojan://p%40ss@host:443?sni=x#t'), ['p@ss']);
  assert.deepEqual(extractSecrets('hysteria2://secretpw@host:443/?sni=x'), ['secretpw']);
  assert.deepEqual(extractSecrets(`tuic://${UUID}:pw@host:443`), [UUID]);
});

test('vmess', () => {
  const b64 = Buffer.from(JSON.stringify({ v: '2', id: UUID, add: 'h' })).toString('base64');
  assert.deepEqual(extractSecrets(`vmess://${b64}`), [UUID]);
});

test('shadowsocks', () => {
  const sip002 = Buffer.from('chacha20-ietf-poly1305:clientpw').toString('base64url');
  assert.deepEqual(extractSecrets(`ss://${sip002}@host:8388#name`), ['clientpw']);
  const ss2022 = Buffer.from('2022-blake3-aes-256-gcm:serverKey:clientKey').toString('base64');
  assert.deepEqual(extractSecrets(`ss://${ss2022}@host:8388`), ['clientKey']);
  const legacy = Buffer.from('aes-256-gcm:legacypw@host:8388').toString('base64');
  assert.deepEqual(extractSecrets(`ss://${legacy}#x`), ['legacypw']);
});

test('голые UUID / subId, мусор и email не принимаются', () => {
  assert.deepEqual(extractSecrets(UUID), [UUID]);
  assert.deepEqual(extractSecrets('k3j4h5g6f7d8'), ['k3j4h5g6f7d8']);
  assert.deepEqual(extractSecrets('привет'), []);
  assert.deepEqual(extractSecrets('user@mail.ru'), []);
  assert.deepEqual(extractSecrets('/start'), []);
});
