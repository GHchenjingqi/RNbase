/**
 * iOS ERPNetwork React Native Bridge
 */
#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(ERPNetwork, NSObject)

RCT_EXTERN_METHOD(getStatus:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
