#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface ZeticLlmExceptionTrap : NSObject
/// Runs the block. Returns nil on success, or an NSError describing any
/// NSException thrown. Avoids the NS_ERROR convention so Swift sees this
/// as a regular function returning NSError?, not a `throws` function.
+ (nullable NSError *)trap:(void (NS_NOESCAPE ^)(void))block
    NS_SWIFT_NAME(trap(_:));
@end

NS_ASSUME_NONNULL_END
