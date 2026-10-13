/**
 * iOS BaseNetwork React Native Bridge
 */
#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(BaseNetwork, NSObject)

RCT_EXTERN_METHOD(getStatus:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
