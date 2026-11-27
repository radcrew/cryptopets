import React from 'react';
import './index.css';

export type DashboardPanelProps = {
    title: React.ReactNode;
    /** Muted line under the title (e.g. "Connect your wallet…"). */
    description?: React.ReactNode;
    /** Controls aligned to the header corner (e.g. refresh). */
    actions?: React.ReactNode;
    /** If provided, renders a ← Back button in the top-left of the title bar. */
    back?: () => void;
    /** Renders below the title bar; intended for the main panel content. */
    children?: React.ReactNode;
    /** Extra classes on the outer `.dashboard-panel` section. */
    className?: string;
    /** Optional id for the heading element (for aria-labelledby). */
    headingId?: string;
    /** Render the description vertically centered in the surface instead of under the title. */
    centerDescription?: boolean;
};

/**
 * Generic dashboard panel surface — title bar, caption, action slot, and panel body.
 * Panel-specific styles compose by passing `className` (e.g. `pet-collection`, `pet-interactions`).
 */
const DashboardPanel: React.FC<DashboardPanelProps> = ({
    title,
    description,
    actions,
    back,
    children,
    className,
    headingId = 'dashboard-panel-heading',
    centerDescription = false,
}) => {
    const rootClass = `dashboard-panel${className ? ` ${className}` : ''}`;

    return (
        <section className={rootClass} aria-labelledby={headingId}>
            <div className="surface">
                <header className="title-bar">
                    {back != null ? (
                        <button
                            type="button"
                            className="panel-back"
                            onClick={back}
                            aria-label="Back"
                        >
                            ‹ Back
                        </button>
                    ) : null}
                    <div className="intro">
                        <h2 id={headingId} className="heading">
                            {title}
                        </h2>
                        {description && !centerDescription ? (
                            <p className="caption">{description}</p>
                        ) : null}
                    </div>
                    {actions != null ? <div className="actions">{actions}</div> : null}
                </header>
                {description && centerDescription ? (
                    <div className="state-body">
                        <p className="caption">{description}</p>
                    </div>
                ) : null}
                {children != null && !centerDescription ? (
                    <div className="panel-body">{children}</div>
                ) : null}
            </div>
        </section>
    );
};

export default DashboardPanel;
