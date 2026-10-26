/**
 * iOS App Target 的 bridging header。
 *
 * 为什么需要：Podfile 没调用 use_frameworks!（默认静态库，产物是 libPods-qux.a），
 * 于是 RN 那些 ObjC pod 没有 Swift 可直接 import 的 clang module —— Swift 文件里的
 * `import React` 不会把 RCTBridgeModule 带进作用域，CI 的 build-ios 报的就是
 * `cannot find type 'RCTBridgeModule' in scope`。ObjC 侧走的是 header search path
 * （同目录的 Base*.m 用 #import <React/RCTBridgeModule.h> 编译通过），Swift 只能靠
 * 这份桥接头拿同一批符号。
 *
 * 接线：project.pbxproj 的 App Target Debug/Release 都设了
 * SWIFT_OBJC_BRIDGING_HEADER = qux/qux-Bridging-Header.h。
 */
#import <React/RCTBridgeModule.h>
