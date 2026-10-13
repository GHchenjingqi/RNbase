/**
 * iOS BaseH5 React Native Bridge
 *
 * Swift 类不会被 RN 自动发现，必须用 RCT_EXTERN_MODULE 导出（同 BaseCapabilities.m）。
 * 方法选择器与 BaseH5.swift 的 @objc(...) 一一对应。
 * 需将本文件与 BaseH5.swift 一起加入 Xcode 的 App Target（见 platforms/ios/TODO.md #3）。
 */
#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(BaseH5, NSObject)

RCT_EXTERN_METHOD(verifyPackageSignature:(NSString)base64Data
                  signature:(NSString)signature
                  publicKey:(NSString)publicKey
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
