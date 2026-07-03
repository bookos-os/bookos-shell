// Evita abrir una consola extra en Windows en release. En Linux es inocuo.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    bookos_shell_lib::run()
}
