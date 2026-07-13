//! JNI exports for Android (`android-jni` feature).
//!
//! Maps Kotlin `expo.modules.sppnative.SppNativeRust` externals onto the C ABI
//! in `lib.rs`. Built only for Android targets with the feature enabled.
//!
//! ```text
//! cargo ndk -t arm64-v8a -t armeabi-v7a -t x86_64 \
//!   -o ../../apps/consumer-app/modules/spp-native/android/src/main/jniLibs \
//!   -- build --release --features android-jni
//! ```

use jni::objects::{JClass, JString};
use jni::sys::{jint, jstring};
use jni::JNIEnv;
#[cfg(target_os = "android")]
use jni22::objects::{JClass as JClass22, JObject as JObject22};
#[cfg(target_os = "android")]
use jni22::sys::{jobject, jstring as jstring22};
#[cfg(target_os = "android")]
use jni22::{Env as Env22, EnvUnowned, Outcome};
use std::ffi::{CStr, CString};
use std::os::raw::c_char;

use crate::{
    spp_native_capabilities, spp_native_deposit, spp_native_derive_keys, spp_native_ensure_asp,
    spp_native_ping, spp_native_pool_balance, spp_native_pool_close, spp_native_pool_open,
    spp_native_pool_readiness, spp_native_pool_sync, spp_native_string_free, spp_native_transfer,
    spp_native_version, spp_native_withdraw,
};

#[cfg(target_os = "android")]
fn env22_new_string(env: &mut Env22, value: &str) -> jstring22 {
    env.new_string(value)
        .unwrap_or_else(|_| env.new_string(r#"{"ok":false,"code":"SPP_JNI_STRING_ERROR","op":"platform_init","message":"Could not allocate JNI string"}"#).expect("fallback jstring"))
        .into_raw()
}

#[cfg(target_os = "android")]
fn env22_platform_error(env: &mut EnvUnowned, code: &str, message: &str) -> jstring22 {
    let message = serde_json::to_string(message)
        .unwrap_or_else(|_| r#""rustls platform verifier initialization failed""#.to_string());
    let json = format!(
        r#"{{"ok":false,"code":"{code}","op":"platform_init","message":{message}}}"#
    );
    match env
        .with_env(|env| -> jni22::errors::Result<jstring22> { Ok(env22_new_string(env, &json)) })
        .into_outcome()
    {
        Outcome::Ok(value) => value,
        _ => std::ptr::null_mut(),
    }
}

fn c_ptr_to_jstring(env: &mut JNIEnv, ptr: *mut c_char) -> jstring {
    if ptr.is_null() {
        return env
            .new_string("")
            .expect("jstring")
            .into_raw();
    }
    let s = unsafe { CStr::from_ptr(ptr) }
        .to_str()
        .unwrap_or("");
    let js = env.new_string(s).expect("jstring");
    unsafe { spp_native_string_free(ptr) };
    js.into_raw()
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_expo_modules_sppnative_SppNativeRust_nativeInitPlatform(
    mut env: EnvUnowned,
    _class: JClass22,
    context: jobject,
) -> jstring22 {
    let outcome = env.with_env(|env| -> jni22::errors::Result<jstring22> {
        if context.is_null() {
            return Ok(env22_new_string(
                env,
                r#"{"ok":false,"code":"SPP_ANDROID_CONTEXT_UNAVAILABLE","op":"platform_init","message":"Android context unavailable for rustls platform verifier initialization"}"#,
            ));
        }

        let context = unsafe { JObject22::from_raw(env, context) };
        match rustls_platform_verifier::android::init_with_env(env, context) {
            Ok(()) => Ok(env22_new_string(
                env,
                r#"{"ok":true,"op":"platform_init","message":"rustls platform verifier initialized"}"#,
            )),
            Err(e) => Ok(env22_new_string(
                env,
                &format!(
                    r#"{{"ok":false,"code":"SPP_PLATFORM_INIT_FAILED","op":"platform_init","message":{}}}"#,
                    serde_json::to_string(&e.to_string()).unwrap_or_else(|_| r#""JNI initialization failed""#.to_string())
                ),
            )),
        }
    });

    match outcome.into_outcome() {
        Outcome::Ok(value) => value,
        Outcome::Err(e) => env22_platform_error(&mut env, "SPP_PLATFORM_INIT_FAILED", &e.to_string()),
        Outcome::Panic(payload) => {
            let panic_message = payload
                .downcast_ref::<&str>()
                .map(|s| (*s).to_string())
                .or_else(|| payload.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "unknown Rust panic".to_string());
            env22_platform_error(&mut env, "SPP_PLATFORM_INIT_PANIC", &panic_message)
        }
    }
}

fn jstring_to_cstring(env: &mut JNIEnv, value: JString) -> Option<CString> {
    let s: String = env.get_string(&value).ok()?.into();
    CString::new(s).ok()
}

#[no_mangle]
pub extern "system" fn Java_expo_modules_sppnative_SppNativeRust_nativeVersion(
    mut env: JNIEnv,
    _class: JClass,
) -> jstring {
    c_ptr_to_jstring(&mut env, spp_native_version())
}

#[no_mangle]
pub extern "system" fn Java_expo_modules_sppnative_SppNativeRust_nativePing(
    mut env: JNIEnv,
    _class: JClass,
    input: JString,
) -> jstring {
    let c = if input.is_null() {
        None
    } else {
        jstring_to_cstring(&mut env, input)
    };
    let ptr = match c.as_ref() {
        Some(cs) => spp_native_ping(cs.as_ptr()),
        None => spp_native_ping(std::ptr::null()),
    };
    c_ptr_to_jstring(&mut env, ptr)
}

#[no_mangle]
pub extern "system" fn Java_expo_modules_sppnative_SppNativeRust_nativeCapabilities(
    _env: JNIEnv,
    _class: JClass,
) -> jint {
    spp_native_capabilities() as jint
}

#[no_mangle]
pub extern "system" fn Java_expo_modules_sppnative_SppNativeRust_nativeDeposit(
    mut env: JNIEnv,
    _class: JClass,
    amount: JString,
) -> jstring {
    let c = jstring_to_cstring(&mut env, amount);
    let ptr = match c.as_ref() {
        Some(cs) => spp_native_deposit(cs.as_ptr()),
        None => spp_native_deposit(std::ptr::null()),
    };
    c_ptr_to_jstring(&mut env, ptr)
}

#[no_mangle]
pub extern "system" fn Java_expo_modules_sppnative_SppNativeRust_nativeTransfer(
    mut env: JNIEnv,
    _class: JClass,
    amount: JString,
    recipient: JString,
) -> jstring {
    let a = jstring_to_cstring(&mut env, amount);
    let r = jstring_to_cstring(&mut env, recipient);
    let ptr = spp_native_transfer(
        a.as_ref().map(|c| c.as_ptr()).unwrap_or(std::ptr::null()),
        r.as_ref().map(|c| c.as_ptr()).unwrap_or(std::ptr::null()),
    );
    c_ptr_to_jstring(&mut env, ptr)
}

#[no_mangle]
pub extern "system" fn Java_expo_modules_sppnative_SppNativeRust_nativeWithdraw(
    mut env: JNIEnv,
    _class: JClass,
    amount: JString,
    to: JString,
) -> jstring {
    let a = jstring_to_cstring(&mut env, amount);
    let t = jstring_to_cstring(&mut env, to);
    let ptr = spp_native_withdraw(
        a.as_ref().map(|c| c.as_ptr()).unwrap_or(std::ptr::null()),
        t.as_ref().map(|c| c.as_ptr()).unwrap_or(std::ptr::null()),
    );
    c_ptr_to_jstring(&mut env, ptr)
}

#[no_mangle]
pub extern "system" fn Java_expo_modules_sppnative_SppNativeRust_nativeEnsureAsp(
    mut env: JNIEnv,
    _class: JClass,
) -> jstring {
    c_ptr_to_jstring(&mut env, spp_native_ensure_asp())
}

#[no_mangle]
pub extern "system" fn Java_expo_modules_sppnative_SppNativeRust_nativeDeriveKeys(
    mut env: JNIEnv,
    _class: JClass,
    sig_hex: JString,
    network: JString,
) -> jstring {
    let s = jstring_to_cstring(&mut env, sig_hex);
    let n = jstring_to_cstring(&mut env, network);
    let ptr = spp_native_derive_keys(
        s.as_ref().map(|c| c.as_ptr()).unwrap_or(std::ptr::null()),
        n.as_ref().map(|c| c.as_ptr()).unwrap_or(std::ptr::null()),
    );
    c_ptr_to_jstring(&mut env, ptr)
}

#[no_mangle]
pub extern "system" fn Java_expo_modules_sppnative_SppNativeRust_nativePoolReadiness(
    mut env: JNIEnv,
    _class: JClass,
) -> jstring {
    c_ptr_to_jstring(&mut env, spp_native_pool_readiness())
}

#[no_mangle]
pub extern "system" fn Java_expo_modules_sppnative_SppNativeRust_nativePoolOpen(
    mut env: JNIEnv,
    _class: JClass,
    config_json: JString,
) -> jstring {
    let c = jstring_to_cstring(&mut env, config_json);
    let ptr = match c.as_ref() {
        Some(cs) => spp_native_pool_open(cs.as_ptr()),
        None => spp_native_pool_open(std::ptr::null()),
    };
    c_ptr_to_jstring(&mut env, ptr)
}

#[no_mangle]
pub extern "system" fn Java_expo_modules_sppnative_SppNativeRust_nativePoolClose(
    mut env: JNIEnv,
    _class: JClass,
) -> jstring {
    c_ptr_to_jstring(&mut env, spp_native_pool_close())
}

#[no_mangle]
pub extern "system" fn Java_expo_modules_sppnative_SppNativeRust_nativePoolSync(
    mut env: JNIEnv,
    _class: JClass,
) -> jstring {
    c_ptr_to_jstring(&mut env, spp_native_pool_sync())
}

#[no_mangle]
pub extern "system" fn Java_expo_modules_sppnative_SppNativeRust_nativePoolBalance(
    mut env: JNIEnv,
    _class: JClass,
) -> jstring {
    c_ptr_to_jstring(&mut env, spp_native_pool_balance())
}
