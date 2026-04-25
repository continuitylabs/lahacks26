#import "ZeticLlmExceptionTrap.h"

@implementation ZeticLlmExceptionTrap

+ (NSError *)trap:(void (NS_NOESCAPE ^)(void))block {
    @try {
        block();
        return nil;
    } @catch (NSException *exception) {
        NSMutableDictionary *info = [NSMutableDictionary dictionary];
        info[NSLocalizedDescriptionKey] = exception.reason ?: exception.name ?: @"NSException";
        info[@"ExceptionName"] = exception.name ?: @"";
        if (exception.userInfo) info[@"ExceptionUserInfo"] = exception.userInfo;
        if (exception.callStackSymbols) info[@"CallStackSymbols"] = exception.callStackSymbols;
        return [NSError errorWithDomain:@"ZeticLlmException" code:0 userInfo:info];
    }
}

@end
