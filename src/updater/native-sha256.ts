/**
 * 原生 SHA-256 校验器（Phase 7 / 规范 §55、§58）。
 *
 * RN/Hermes 无 Web Crypto subtle，走原生 ERPH5.sha256（MessageDigest），
 * 返回小写 hex。base64 由本地工具分块编码，避免大数据爆栈。
 */
import { NativeModules } from 'react-native';
import type { Sha256Hasher } from './verifier';
import { bytesToBase64 } from './base64';

const ERPH5 = NativeModules.ERPH5;

export const nativeSha256Hasher: Sha256Hasher = async data => {
  if (!ERPH5 || typeof ERPH5.sha256 !== 'function') {
    throw new Error('ERPH5 原生模块未注册，无法计算 SHA-256');
  }
  const hex = await ERPH5.sha256(bytesToBase64(data));
  return String(hex).toLowerCase();
};
