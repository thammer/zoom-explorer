/**
 * Diagnostics the driver can detect but not fix: conditions that are always a
 * bug in whoever produced the data (the host application, this driver, or the
 * pedal), and that used to be visible only as a console line. A deployed app
 * never sees the console, which is how a refused send ran on every connect for
 * a day without anyone noticing.
 *
 * The host application can register ZoomDriverDiagnostics.listener to surface
 * them. This module stays dependency-free: no telemetry here.
 *
 * Reporting only observes. Every site that notifies keeps its existing log line
 * and its existing behaviour: a refused send still refuses, buildPTCFChunk()
 * still zero-fills missing parameter values, and readPTCF() still parses
 * whatever it was given.
 */

/** Which of the two send paths refused the current-patch data. */
export type CurrentPatchSendSite = "probe_restore" | "upload_current_patch";

export type DriverDiagnostic =
  {
    /**
     * Current-patch data that was meant for the pedal never reached it. The
     * edit or restore behind the send is lost, and nothing tells the user.
     * See ZoomDevice.sendCurrentPatchData().
     */
    kind: "current_patch_send_refused";
    site: CurrentPatchSendSite;
    reason: "oversize" |         // longer than the patch length the pedal reported
            "length_mismatch" |  // MSOG: not exactly the patch length the pedal reported
            "invalid_patch";     // the patch could not be built, or was too short to be one
    suppliedLength: number;      // -1 when the patch could not be built at all
    reportedLength: number;      // the pedal's patch length, -1 if it never reported one
    deviceName: string;          // several pedals can be attached at once
  } |
  {
    /**
     * An effect with a real ID carries no parameter values. Building a patch
     * from it writes every knob value as 0 (see ZoomPatch.buildPTCFChunk()),
     * which is how a patch with real effects and all-zero knobs comes about.
     *
     * route "build": the patch object was built wrong by whoever made it.
     * route "parse": the patch data itself had a short EDTB entry, so the
     * parser never had any values to put there.
     */
    kind: "effect_parameters_missing";
    route: "build" | "parse";
    patchName: string;
    slot: number;
    effectId: number;
    edtbSliceLength?: number;    // parse only: bytes available for this effect
    numEffects?: number;         // parse only
    edtbChunkLength?: number;    // parse only: length of the whole EDTB chunk
  };

export class ZoomDriverDiagnostics
{
  // Called on every diagnostic above, if the app registered a listener.
  // Failures in the listener are swallowed: reporting must never become a
  // second fault inside the operation it is reporting on.
  public static listener: ((diagnostic: DriverDiagnostic) => void) | undefined = undefined;

  // Public, unlike ZoomScreenCollection's private notifier, because the sites
  // that report live in both ZoomDevice and ZoomPatch.
  public static notify(diagnostic: DriverDiagnostic): void
  {
    try {
      ZoomDriverDiagnostics.listener?.(diagnostic);
    } catch {
      // reporting must never break the operation it is reporting on
    }
  }
}
