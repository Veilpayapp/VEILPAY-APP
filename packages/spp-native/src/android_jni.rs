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
use std::ffi::{CStr, CString};
use std::os::raw::c_char;

use crate::{
    spp_native_capabilities, spp_native_deposit, spp_native_derive_keys, spp_native_ensure_asp,
    spp_native_ping, spp_native_pool_close, spp_native_pool_open, spp_native_pool_readiness,
    spp_native_string_free, spp_native_transfer, spp_native_version, spp_native_withdraw,
};

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
