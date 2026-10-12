/**
 * iOS ERPCapabilities React Native Bridge
 *
 * Swift 类不会被 RN 自动发现，必须像 ERPNetwork.m 一样用 RCT_EXTERN_MODULE 导出。
 * 方法选择器与 ERPCapabilities.swift 的 @objc(...) 一一对应，新增方法要同步在此声明，
 * 否则 JS 侧 NativeModules.ERPCapabilities 取不到该方法（按缺失降级为 DEVICE_UNSUPPORTED）。
 */
#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(ERPCapabilities, NSObject)

RCT_EXTERN_METHOD(scan:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(takePhoto:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(pickImage:(NSDictionary)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(saveImage:(NSString)uri
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(filePick:(NSDictionary)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(fileDownload:(NSString)url
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(fileOpen:(NSString)uri
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(clipboardSetString:(NSString)text
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(clipboardGetString:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(clipboardHasString:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(appOpenSettings:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getCurrentPosition:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
