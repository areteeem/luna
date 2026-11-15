/* Thin C ABI over the NASA NAIF CSPICE Toolkit for the browser worker. */
#include "SpiceUsr.h"

static SpiceDouble out[9];
static SpiceChar error[1841];

double *result(void) { return out; }
void configure(void) {
    erract_c("SET", 0, "RETURN");
    errprt_c("SET", 0, "NONE");
}
const char *last_error(void) {
    if (!failed_c()) return "";
    getmsg_c("LONG", sizeof error, error);
    reset_c();
    return error;
}
void load_kernel(const char *path) { furnsh_c(path); }
double time_et(const char *utc) {
    SpiceDouble et = 0;
    str2et_c(utc, &et);
    return et;
}
void frame_transform(const char *from, const char *to, double et) {
    pxform_c(from, to, et, (SpiceDouble (*)[3])out);
}
void frame_transform_times(const char *from, const char *to, double from_et, double to_et) {
    pxfrm2_c(from, to, from_et, to_et, (SpiceDouble (*)[3])out);
}
void position(const char *target, double et, const char *frame, const char *correction, const char *observer) {
    spkpos_c(target, et, frame, correction, observer, out, out + 3);
}
void observer_state(const char *target, double et, const char *frame, const char *locus,
                    const char *correction, double x, double y, double z,
                    const char *center, const char *observer_frame) {
    const SpiceDouble observer[3] = { x, y, z };
    spkcpo_c(target, et, frame, locus, correction, observer, center, observer_frame, out, out + 6);
}
void geodetic(double x, double y, double z, double radius, double flattening) {
    const SpiceDouble position[3] = { x, y, z };
    recgeo_c(position, radius, flattening, out, out + 1, out + 2);
}
