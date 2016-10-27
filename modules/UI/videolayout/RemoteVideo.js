/* global $, APP, interfaceConfig */

import ConnectionIndicator from './ConnectionIndicator';

import SmallVideo from "./SmallVideo";
import UIUtils from "../util/UIUtil";
import UIEvents from '../../../service/UI/UIEvents';
import JitsiPopover from "../util/JitsiPopover";
import jitsiLocalStorage from '../../util/JitsiLocalStorage';

const MUTED_DIALOG_BUTTON_VALUES = {
    cancel: 0,
    muted: 1
};

/**
 * Creates new instance of the <tt>RemoteVideo</tt>.
 * @param user {JitsiParticipant} the user for whom remote video instance will
 * be created.
 * @param {VideoLayout} VideoLayout the video layout instance.
 * @param {EventEmitter} emitter the event emitter which will be used by
 * the new instance to emit events.
 * @constructor
 */
function RemoteVideo(user, VideoLayout, emitter) {
    this.user = user;
    this.id = user.getId();
    this.emitter = emitter;
    this.videoSpanId = `participant_${this.id}`;
    SmallVideo.call(this, VideoLayout);
    this.hasRemoteVideoMenu = false;
    this.addRemoteVideoContainer();
    this.connectionIndicator = new ConnectionIndicator(this, this.id);
    this.setDisplayName();
    this.flipX = false;
    this.isLocal = false;
    /**
     * The flag is set to <tt>true</tt> after the 'onplay' event has been
     * triggered on the current video element. It goes back to <tt>false</tt>
     * when the stream is removed. It is used to determine whether the video
     * playback has ever started.
     * @type {boolean}
     */
    this.wasVideoPlayed = false;
    /**
     * The flag is set to <tt>true</tt> if remote participant's video gets muted
     * during his media connection disruption. This is to prevent black video
     * being render on the thumbnail, because even though once the video has
     * been played the image usually remains on the video element it seems that
     * after longer period of the video element being hidden this image can be
     * lost.
     * @type {boolean}
     */
    this.mutedWhileDisconnected = false;
}

RemoteVideo.prototype = Object.create(SmallVideo.prototype);
RemoteVideo.prototype.constructor = RemoteVideo;

RemoteVideo.prototype.addRemoteVideoContainer = function() {
    this.container = RemoteVideo.createContainer(this.videoSpanId);

    this.initBrowserSpecificProperties();

    if (APP.conference.isModerator) {
        this.addRemoteVideoMenu();
    }

    this.VideoLayout.resizeThumbnails(false, true);

    this.addAudioLevelIndicator();

    return this.container;
};

/**
 * Initializes the remote participant popup menu, by specifying previously
 * constructed popupMenuElement, containing all the menu items.
 *
 * @param popupMenuElement a pre-constructed element, containing the menu items
 * to display in the popup
 */
RemoteVideo.prototype._initPopupMenu = function (popupMenuElement) {
    let options = {
        content: popupMenuElement.outerHTML,
        skin: "black",
        hasArrow: false,
        onBeforePosition: el => APP.translation.translateElement(el)
    };
    let element = $("#" + this.videoSpanId + " .remotevideomenu");
    this.popover = new JitsiPopover(element, options);

    // override popover show method to make sure we will update the content
    // before showing the popover
    let origShowFunc = this.popover.show;
    this.popover.show = function () {
        // update content by forcing it, to finish even if popover
        // is not visible
        this.updateRemoteVideoMenu(this.isAudioMuted, true);
        // call the original show, passing its actual this
        origShowFunc.call(this.popover);
    }.bind(this);
};

/**
 * Generates the popup menu content.
 *
 * @returns {Element|*} the constructed element, containing popup menu items
 * @private
 */
RemoteVideo.prototype._generatePopupContent = function () {
    var popupmenuElement = document.createElement('ul');
    popupmenuElement.className = 'popupmenu';
    popupmenuElement.id = `remote_popupmenu_${this.id}`;

    var muteMenuItem = document.createElement('li');
    var muteLinkItem = document.createElement('a');

    var mutedIndicator = "<i class='icon-mic-disabled'></i>";

    var doMuteHTML = mutedIndicator +
        " <div data-i18n='videothumbnail.domute'></div>";

    var mutedHTML = mutedIndicator +
        " <div data-i18n='videothumbnail.muted'></div>";

    muteLinkItem.id = "mutelink_" + this.id;

    if (this.isAudioMuted) {
        muteLinkItem.innerHTML = mutedHTML;
        muteLinkItem.className = 'mutelink disabled';
    }
    else {
        muteLinkItem.innerHTML = doMuteHTML;
        muteLinkItem.className = 'mutelink';
    }

    // Delegate event to the document.
    $(document).on("click", "#mutelink_" + this.id, () => {
        if (this.isAudioMuted)
            return;

        RemoteVideo.showMuteParticipantDialog().then(reason => {
            if(reason === MUTED_DIALOG_BUTTON_VALUES.muted) {
                this.emitter.emit(UIEvents.REMOTE_AUDIO_MUTED, this.id);
            }
        }).catch(e => {
            //currently shouldn't be called
            console.error(e);
        });

        this.popover.forceHide();
    });

    muteMenuItem.appendChild(muteLinkItem);
    popupmenuElement.appendChild(muteMenuItem);

    var ejectIndicator = "<i style='float:left;' class='icon-kick'></i>";

    var ejectMenuItem = document.createElement('li');
    var ejectLinkItem = document.createElement('a');

    var ejectText = "<div data-i18n='videothumbnail.kick'></div>";

    ejectLinkItem.className = 'ejectlink';
    ejectLinkItem.innerHTML = ejectIndicator + ' ' + ejectText;
    ejectLinkItem.id = "ejectlink_" + this.id;

    $(document).on("click", "#ejectlink_" + this.id, function(){
        this.emitter.emit(UIEvents.USER_KICKED, this.id);
        this.popover.forceHide();
    }.bind(this));

    ejectMenuItem.appendChild(ejectLinkItem);
    popupmenuElement.appendChild(ejectMenuItem);

    APP.translation.translateElement($(popupmenuElement));

    return popupmenuElement;
};

/**
 * Updates the remote video menu.
 *
 * @param isMuted the new muted state to update to
 * @param force to work even if popover is not visible
 */
RemoteVideo.prototype.updateRemoteVideoMenu = function (isMuted, force) {

    this.isAudioMuted = isMuted;

    // generate content, translate it and add it to document only if
    // popover is visible or we force to do so.
    if(this.popover.popoverShown || force) {
        this.popover.updateContent(this._generatePopupContent());
    }
};

/**
 * @inheritDoc
 */
RemoteVideo.prototype.setMutedView = function(isMuted) {
    SmallVideo.prototype.setMutedView.call(this, isMuted);
    // Update 'mutedWhileDisconnected' flag
    this._figureOutMutedWhileDisconnected(this.isConnectionActive() === false);
};

/**
 * Figures out the value of {@link #mutedWhileDisconnected} flag by taking into
 * account remote participant's network connectivity and video muted status.
 *
 * @param {boolean} isDisconnected <tt>true</tt> if the remote participant is
 * currently having connectivity issues or <tt>false</tt> otherwise.
 *
 * @private
 */
RemoteVideo.prototype._figureOutMutedWhileDisconnected
= function(isDisconnected) {
    if (isDisconnected && this.isVideoMuted) {
        this.mutedWhileDisconnected = true;
    } else if (!isDisconnected && !this.isVideoMuted) {
        this.mutedWhileDisconnected = false;
    }
};

/**
 * Adds the remote video menu element for the given <tt>id</tt> in the
 * given <tt>parentElement</tt>.
 *
 * @param id the id indicating the video for which we're adding a menu.
 * @param parentElement the parent element where this menu will be added
 */
if (!interfaceConfig.filmStripOnly) {
    RemoteVideo.prototype.addRemoteVideoMenu = function () {

        var spanElement = document.createElement('span');
        spanElement.className = 'remotevideomenu toolbar-icon right';

        this.container
            .querySelector('.videocontainer__toolbar')
            .appendChild(spanElement);

        var menuElement = document.createElement('i');
        menuElement.className = 'icon-menu-up';
        menuElement.title = 'Remote user controls';
        spanElement.appendChild(menuElement);

        this._initPopupMenu(this._generatePopupContent());
        this.hasRemoteVideoMenu = true;
    };

} else {
    RemoteVideo.prototype.addRemoteVideoMenu = function() {};
}

/**
 * Removes the remote stream element corresponding to the given stream and
 * parent container.
 *
 * @param stream the MediaStream
 * @param isVideo <tt>true</tt> if given <tt>stream</tt> is a video one.
 */
RemoteVideo.prototype.removeRemoteStreamElement = function (stream) {
    if (!this.container)
        return false;

    var isVideo = stream.isVideoTrack();

    var elementID = SmallVideo.getStreamElementID(stream);
    var select = $('#' + elementID);
    select.remove();

    if (isVideo) {
        this.wasVideoPlayed = false;
    }

    console.info((isVideo ? "Video" : "Audio") +
                 " removed " + this.id, select);

    // when removing only the video element and we are on stage
    // update the stage
    if (isVideo && this.isCurrentlyOnLargeVideo())
        this.VideoLayout.updateLargeVideo(this.id);
    else
        // Missing video stream will affect display mode
        this.updateView();
};

/**
 * Checks whether the remote user associated with this <tt>RemoteVideo</tt>
 * has connectivity issues.
 *
 * @return {boolean} <tt>true</tt> if the user's connection is fine or
 * <tt>false</tt> otherwise.
 */
RemoteVideo.prototype.isConnectionActive = function() {
    return this.user.isConnectionActive();
};

/**
 * The remote video is considered "playable" once the stream has started
 * according to the {@link #hasVideoStarted} result.
 *
 * @inheritdoc
 * @override
 */
RemoteVideo.prototype.isVideoPlayable = function () {
    return SmallVideo.prototype.isVideoPlayable.call(this)
        && this.hasVideoStarted() && !this.mutedWhileDisconnected;
};

/**
 * @inheritDoc
 */
RemoteVideo.prototype.updateView = function () {

    this.updateConnectionStatusIndicator(
        null /* will obtain the status from 'conference' */);

    // This must be called after 'updateConnectionStatusIndicator' because it
    // affects the display mode by modifying 'mutedWhileDisconnected' flag
    SmallVideo.prototype.updateView.call(this);
};

/**
 * Updates the UI to reflect user's connectivity status.
 * @param isActive {boolean|null} 'true' if user's connection is active or
 * 'false' when the use is having some connectivity issues and a warning
 * should be displayed. When 'null' is passed then the current value will be
 * obtained from the conference instance.
 */
RemoteVideo.prototype.updateConnectionStatusIndicator = function (isActive) {
    // Check for initial value if 'isActive' is not defined
    if (typeof isActive !== "boolean") {
        isActive = this.isConnectionActive();
        if (isActive === null) {
            // Cancel processing at this point - no update
            return;
        }
    }

    console.debug(this.id + " thumbnail is connection active ? " + isActive);

    // Update 'mutedWhileDisconnected' flag
    this._figureOutMutedWhileDisconnected(!isActive);

    if(this.connectionIndicator)
        this.connectionIndicator.updateConnectionStatusIndicator(isActive);

    // Toggle thumbnail video problem filter
    this.selectVideoElement().toggleClass(
        "videoThumbnailProblemFilter", !isActive);
    this.$avatar().toggleClass(
        "videoThumbnailProblemFilter", !isActive);
};

/**
 * Removes RemoteVideo from the page.
 */
RemoteVideo.prototype.remove = function () {
    console.log("Remove thumbnail", this.id);
    this.removeConnectionIndicator();
    // Make sure that the large video is updated if are removing its
    // corresponding small video.
    this.VideoLayout.updateAfterThumbRemoved(this.id);
    // Remove whole container
    if (this.container.parentNode) {
        this.container.parentNode.removeChild(this.container);
    }
};

RemoteVideo.prototype.waitForPlayback = function (streamElement, stream) {

    var webRtcStream = stream.getOriginalStream();
    var isVideo = stream.isVideoTrack();
    if (!isVideo || webRtcStream.id === 'mixedmslabel') {
        return;
    }

    var self = this;

    // Register 'onplaying' listener to trigger 'videoactive' on VideoLayout
    // when video playback starts
    var onPlayingHandler = function () {
        self.wasVideoPlayed = true;
        self.VideoLayout.videoactive(streamElement, self.id);
        streamElement.onplaying = null;
        // Refresh to show the video
        self.updateView();
    };
    streamElement.onplaying = onPlayingHandler;
};

/**
 * Checks whether the video stream has started for this RemoteVideo instance.
 *
 * @returns {boolean} true if this RemoteVideo has a video stream for which
 * the playback has been started.
 */
RemoteVideo.prototype.hasVideoStarted = function () {
    return this.wasVideoPlayed;
};

RemoteVideo.prototype.addRemoteStreamElement = function (stream) {
    if (!this.container) {
        return;
    }

    let isVideo = stream.isVideoTrack();
    isVideo ? this.videoStream = stream : this.audioStream = stream;

    if (isVideo)
        this.setVideoType(stream.videoType);

    // Add click handler.
    let onClickHandler = (event) => {
        let source = event.target || event.srcElement;

        // ignore click if it was done in popup menu
        if ($(source).parents('.popupmenu').length === 0) {
            this.VideoLayout.handleVideoThumbClicked(this.id);
        }

        // On IE we need to populate this handler on video <object>
        // and it does not give event instance as an argument,
        // so we check here for methods.
        if (event.stopPropagation && event.preventDefault) {
            event.stopPropagation();
            event.preventDefault();
        }
        return false;
    };
    this.container.onclick = onClickHandler;

    if(!stream.getOriginalStream())
        return;

    let streamElement = SmallVideo.createStreamElement(stream);

    // Put new stream element always in front
    UIUtils.prependChild(this.container, streamElement);

    // If we hide element when Temasys plugin is used then
    // we'll never receive 'onplay' event and other logic won't work as expected
    // NOTE: hiding will not have effect when Temasys plugin is in use, as
    // calling attach will show it back
    $(streamElement).hide();

    // If the container is currently visible
    // we attach the stream to the element.
    if (!isVideo || (this.container.offsetParent !== null && isVideo)) {
        this.waitForPlayback(streamElement, stream);

        streamElement = stream.attach(streamElement);
    }

    $(streamElement).click(onClickHandler);
},

/**
 * Show/hide peer container for the given id.
 */
RemoteVideo.prototype.showPeerContainer = function (state) {
    if (!this.container)
        return;

    var isHide = state === 'hide';
    var resizeThumbnails = false;

    if (!isHide) {
        if (!$(this.container).is(':visible')) {
            resizeThumbnails = true;
            $(this.container).show();
        }
        // Call updateView, so that we'll figure out if avatar
        // should be displayed based on video muted status and whether or not
        // it's in the lastN set
        this.updateView();
    }
    else if ($(this.container).is(':visible') && isHide)
    {
        resizeThumbnails = true;
        $(this.container).hide();
        if(this.connectionIndicator)
            this.connectionIndicator.hide();
    }

    if (resizeThumbnails) {
        this.VideoLayout.resizeThumbnails();
    }

    // We want to be able to pin a participant from the contact list, even
    // if he's not in the lastN set!
    // ContactList.setClickable(id, !isHide);

};

RemoteVideo.prototype.updateResolution = function (resolution) {
    if (this.connectionIndicator) {
        this.connectionIndicator.updateResolution(resolution);
    }
};

RemoteVideo.prototype.removeConnectionIndicator = function () {
    if (this.connectionIndicator)
        this.connectionIndicator.remove();
};

RemoteVideo.prototype.hideConnectionIndicator = function () {
    if (this.connectionIndicator)
        this.connectionIndicator.hide();
};

/**
 * Sets the display name for the given video span id.
 */
RemoteVideo.prototype.setDisplayName = function(displayName, key) {

    if (!this.container) {
        console.warn( "Unable to set displayName - " + this.videoSpanId +
                " does not exist");
        return;
    }

    var nameSpan = $('#' + this.videoSpanId + ' .displayname');

    // If we already have a display name for this video.
    if (nameSpan.length > 0) {
        if (displayName && displayName.length > 0) {
            var displaynameSpan = $('#' + this.videoSpanId + '_name');
            if (displaynameSpan.text() !== displayName)
                displaynameSpan.text(displayName);
        }
        else if (key && key.length > 0) {
            var nameHtml = APP.translation.generateTranslationHTML(key);
            $('#' + this.videoSpanId + '_name').html(nameHtml);
        }
        else
            $('#' + this.videoSpanId + '_name').text(
                interfaceConfig.DEFAULT_REMOTE_DISPLAY_NAME);
    } else {
        nameSpan = document.createElement('span');
        nameSpan.className = 'displayname';
        $('#' + this.videoSpanId)[0]
            .querySelector('.videocontainer__toolbar')
            .appendChild(nameSpan);

        if (displayName && displayName.length > 0) {
            $(nameSpan).text(displayName);
        } else {
            nameSpan.innerHTML = interfaceConfig.DEFAULT_REMOTE_DISPLAY_NAME;
        }
        nameSpan.id = this.videoSpanId + '_name';
    }
};

/**
 * Removes remote video menu element from video element identified by
 * given <tt>videoElementId</tt>.
 *
 * @param videoElementId the id of local or remote video element.
 */
RemoteVideo.prototype.removeRemoteVideoMenu = function() {
    var menuSpan = $('#' + this.videoSpanId + '> .remotevideomenu');
    if (menuSpan.length) {
        this.popover.forceHide();
        menuSpan.remove();
        this.hasRemoteVideoMenu = false;
    }
};

RemoteVideo.createContainer = function (spanId) {
    let container = document.createElement('span');
    container.id = spanId;
    container.className = 'videocontainer';

    let toolbar = document.createElement('div');
    toolbar.className = "videocontainer__toolbar";
    container.appendChild(toolbar);

    var remotes = document.getElementById('remoteVideos');
    return remotes.appendChild(container);
};

/**
 * Shows 2 button dialog for confirmation from the user for muting remote
 * participant.
 */
RemoteVideo.showMuteParticipantDialog = function () {
    //FIXME: don't show again checkbox is implemented very dirty. we should add
    // this functionality to MessageHandler class.
    if (jitsiLocalStorage.getItem(
            "dontShowMuteParticipantDialog") === "true") {
        return Promise.resolve(MUTED_DIALOG_BUTTON_VALUES.muted);
    }
    let msgString =
        `<div data-i18n="dialog.muteParticipantBody"></div>
        <br />
        <label>
            <input type='checkbox' checked id='doNotShowMessageAgain' />
            <span data-i18n='dialog.doNotShowMessageAgain'></span>
        </label>`;
    return new Promise(resolve => {
        APP.UI.messageHandler.openTwoButtonDialog({
            titleKey : "dialog.muteParticipantTitle",
            msgString,
            leftButtonKey: 'dialog.muteParticipantButton',
            submitFunction: () => {
                let form  = $.prompt.getPrompt();
                if (form) {
                    let input = form.find("#doNotShowMessageAgain");
                    if (input.length) {
                        jitsiLocalStorage.setItem(
                            "dontShowMuteParticipantDialog",
                            input.prop("checked"));
                    }
                }
                resolve(MUTED_DIALOG_BUTTON_VALUES.muted);
            },
            closeFunction: () => resolve(MUTED_DIALOG_BUTTON_VALUES.cancel)
        });
    });
};

export default RemoteVideo;
