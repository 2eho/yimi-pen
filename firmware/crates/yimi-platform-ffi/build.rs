//! Compiles the independent C reference mock only for host conformance tests.

fn main() {
    println!("cargo:rerun-if-changed=../../abi/yimi_platform_v1.h");
    println!("cargo:rerun-if-changed=../../abi/yimi_platform_mock.h");
    println!("cargo:rerun-if-changed=../../abi/yimi_platform_mock.c");

    if std::env::var_os("CARGO_FEATURE_HOST_MOCK").is_none() {
        return;
    }

    cc::Build::new()
        .include("../../abi")
        .file("../../abi/yimi_platform_mock.c")
        .std("c11")
        .warnings(true)
        .warnings_into_errors(true)
        .compile("yimi_platform_mock_v1");
}
